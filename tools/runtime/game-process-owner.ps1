param(
    [Parameter(Mandatory = $true)][int]$OwnerPid,
    [Parameter(Mandatory = $true)][string]$StatusFile,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-f0-9]{48}$')][string]$Token
)
$ErrorActionPreference = 'Stop'
$ownerExited = $false
try {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class HolodekProcessOwner {
    [StructLayout(LayoutKind.Sequential)] struct BasicLimit {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit {
        public BasicLimit BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimit info, uint size);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    static void Check(bool value) { if (!value) throw new Win32Exception(Marshal.GetLastWin32Error()); }

    public static void Run(int pid, string statusFile, string token) {
        IntPtr owner = IntPtr.Zero, job = IntPtr.Zero;
        try {
            // A handle, not a later PID lookup, protects against PID reuse.
            owner = OpenProcess(0x00101101, false, pid);
            Check(owner != IntPtr.Zero);
            job = CreateJobObject(IntPtr.Zero, null);
            Check(job != IntPtr.Zero);
            ExtendedLimit limits = new ExtendedLimit();
            limits.BasicLimitInformation.LimitFlags = 0x00002000; // KILL_ON_JOB_CLOSE; no breakaway.
            Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimit))));
            Check(AssignProcessToJobObject(job, owner));
            string receipt = "{\"ready\":true,\"ownerPid\":" + pid + ",\"token\":\"" + token + "\"}";
            File.WriteAllText(statusFile + ".tmp", receipt, new UTF8Encoding(false));
            File.Move(statusFile + ".tmp", statusFile);
            Check(WaitForSingleObject(owner, 0xffffffff) == 0);
        } finally {
            if (job != IntPtr.Zero) CloseHandle(job);
            if (owner != IntPtr.Zero) CloseHandle(owner);
        }
    }
}
'@
    [HolodekProcessOwner]::Run($OwnerPid, $StatusFile, $Token)
    $ownerExited = $true
} catch {
    if (-not (Test-Path -LiteralPath $StatusFile)) {
        $receipt = @{ ready = $false; ownerPid = $OwnerPid; token = $Token; error = $_.Exception.Message } | ConvertTo-Json -Compress
        [System.IO.File]::WriteAllText($StatusFile, $receipt, (New-Object System.Text.UTF8Encoding($false)))
    }
    exit 1
} finally {
    # Only our fixed receipt paths, never a recursive computed-directory delete.
    if ($ownerExited) {
        Remove-Item -LiteralPath ($StatusFile + '.tmp') -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $StatusFile -Force -ErrorAction SilentlyContinue
        $folder = [System.IO.Path]::GetDirectoryName($StatusFile)
        try { [System.IO.Directory]::Delete($folder, $false) } catch {}
    }
}
