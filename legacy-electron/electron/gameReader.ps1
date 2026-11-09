# Liest den Sitzungs-Token (?accountId=...&nonce=...) aus dem laufenden Warframe-Prozess.
# Nur Lesezugriff: kein Schreiben, keine Code-Injektion. Gleiches Verfahren wie
# Sainan/warframe-api-helper: der Token muss 3x identisch im Speicher stehen.
# Ausgabe (stdout): "<token><TAB><Speicherbereiche>" oder "ERR:<Grund>".
# -Hint: Speicherbereiche vom letzten Lauf, die zuerst durchsucht werden.

param([string]$Hint = '')

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class WfAuthz
{
    [StructLayout(LayoutKind.Sequential)]
    struct MBI
    {
        public IntPtr BaseAddress;
        public IntPtr AllocationBase;
        public uint AllocationProtect;
        public ushort PartitionId;
        public IntPtr RegionSize;
        public uint State;
        public uint Protect;
        public uint Type;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr VirtualQueryEx(IntPtr h, IntPtr addr, out MBI mbi, IntPtr len);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, IntPtr size, out IntPtr read);

    const uint PROCESS_QUERY_INFORMATION = 0x0400;
    const uint PROCESS_VM_READ = 0x0010;
    const uint MEM_COMMIT = 0x1000;
    const uint MEM_PRIVATE = 0x20000;
    const uint PAGE_READWRITE = 0x04;
    const uint PAGE_GUARD = 0x100;
    const int CHUNK = 4 << 20;
    const int OVERLAP = 128;
    static readonly byte[] Needle = Encoding.ASCII.GetBytes("?accountId=");

    static int hitCount;

    /// <param name="hints">Kommagetrennte Startadressen (hex) von Bereichen, in denen der Token
    /// beim letzten Mal lag. Die werden zuerst durchsucht – spart meist den kompletten Scan.</param>
    /// <returns>"token\tbereich1,bereich2" oder "ERR:…"</returns>
    public static string Find(string hints)
    {
        Process[] procs = Process.GetProcessesByName("Warframe.x64");
        if (procs.Length == 0) return "ERR:NOT_RUNNING";
        IntPtr h = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, procs[0].Id);
        if (h == IntPtr.Zero) return "ERR:OPEN_FAILED";
        try
        {
            Dictionary<string, int> seen = new Dictionary<string, int>();
            List<long> hitRegions = new List<long>();
            HashSet<long> done = new HashSet<long>();
            byte[] buf = new byte[CHUNK + OVERLAP];
            int mbiSize = Marshal.SizeOf(typeof(MBI));
            MBI m;

            foreach (string s in (hints ?? "").Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries))
            {
                long hint;
                if (!long.TryParse(s, System.Globalization.NumberStyles.HexNumber, null, out hint)) continue;
                if (VirtualQueryEx(h, new IntPtr(hint), out m, new IntPtr(mbiSize)) == IntPtr.Zero) continue;
                string hit = ScanRegion(h, m, buf, seen, hitRegions, done);
                if (hit != null) return Result(hit, hitRegions);
            }

            long addr = 0;
            while (VirtualQueryEx(h, new IntPtr(addr), out m, new IntPtr(mbiSize)) != IntPtr.Zero)
            {
                string hit = ScanRegion(h, m, buf, seen, hitRegions, done);
                if (hit != null) return Result(hit, hitRegions);
                long next = m.BaseAddress.ToInt64() + m.RegionSize.ToInt64();
                if (next <= addr) break;
                addr = next;
            }
            // Kein Token 3x gefunden: den häufigsten Kandidaten versuchen.
            string best = null;
            int bestCount = 0;
            foreach (KeyValuePair<string, int> kv in seen)
            {
                if (kv.Value > bestCount) { best = kv.Key; bestCount = kv.Value; }
            }
            return best != null ? Result(best, hitRegions) : "ERR:NOT_FOUND";
        }
        finally
        {
            CloseHandle(h);
        }
    }

    static string Result(string token, List<long> regions)
    {
        return token + "\t" + string.Join(",", regions.ConvertAll(r => r.ToString("x")).ToArray());
    }

    static string ScanRegion(IntPtr h, MBI m, byte[] buf, Dictionary<string, int> seen, List<long> hitRegions, HashSet<long> done)
    {
        long start = m.BaseAddress.ToInt64();
        long size = m.RegionSize.ToInt64();
        bool scan = m.State == MEM_COMMIT && m.Type == MEM_PRIVATE
            && (m.Protect & PAGE_READWRITE) != 0 && (m.Protect & PAGE_GUARD) == 0;
        if (!scan || !done.Add(start)) return null;

        int before = hitCount;
        string result = null;
        for (long off = 0; off < size && result == null; off += CHUNK)
        {
            int want = (int)Math.Min(CHUNK + OVERLAP, size - off);
            IntPtr got;
            if (!ReadProcessMemory(h, new IntPtr(start + off), buf, new IntPtr(want), out got)) continue;
            result = Scan(buf, (int)got, seen);
        }
        if (hitCount != before) hitRegions.Add(start);
        return result;
    }

    // Horspool-Sprungtabelle: bei einem Fehlvergleich bis zu 11 Bytes überspringen.
    static readonly int[] Skip = BuildSkip();
    static int[] BuildSkip()
    {
        int[] t = new int[256];
        for (int i = 0; i < 256; i++) t[i] = Needle.Length;
        for (int i = 0; i < Needle.Length - 1; i++) t[Needle[i]] = Needle.Length - 1 - i;
        return t;
    }

    static string Scan(byte[] b, int len, Dictionary<string, int> seen)
    {
        // Treffer, die im Überlappungsbereich beginnen, zählt erst der nächste Block.
        int limit = Math.Min(len, CHUNK);
        int last = Needle.Length - 1;
        int i = 0;
        while (i < limit && i + 11 + 24 + 7 < len)
        {
            byte tail = b[i + last];
            if (tail != Needle[last]) { i += Skip[tail]; continue; }
            bool ok = true;
            for (int k = 0; k < last; k++)
            {
                if (b[i + k] != Needle[k]) { ok = false; break; }
            }
            if (!ok) { i += Skip[tail]; continue; }
            string hit = Parse(b, i, len, seen);
            if (hit != null) return hit;
            i++;
        }
        return null;
    }

    static string Parse(byte[] b, int i, int len, Dictionary<string, int> seen)
    {
        int p = i + 11;
        StringBuilder sb = new StringBuilder("?accountId=");
        for (int k = 0; k < 24; k++)
        {
            char c = (char)b[p + k];
            if (!Uri.IsHexDigit(c)) return null;
            sb.Append(c);
        }
        p += 24;
        if (Encoding.ASCII.GetString(b, p, 7) != "&nonce=") return null;
        p += 7;
        sb.Append("&nonce=");
        int digits = 0;
        while (p < len && digits < 20 && b[p] >= 0x30 && b[p] <= 0x39)
        {
            sb.Append((char)b[p]);
            p++;
            digits++;
        }
        if (digits == 0) return null;

        hitCount++;
        string s = sb.ToString();
        int n;
        seen.TryGetValue(s, out n);
        seen[s] = ++n;
        return n >= 3 ? s : null;
    }
}
'@

try {
    [Console]::Out.Write([WfAuthz]::Find($Hint))
} catch {
    [Console]::Out.Write('ERR:' + $_.Exception.Message)
}
