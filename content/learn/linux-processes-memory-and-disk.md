---
title: "Linux 04: Processes, memory and disk: why the server is slow or full"
description: Learn what a Linux process is, how to read load, memory and disk numbers, stop programs gracefully and find out why a server is slow or full.
type: guide
tags:
  - learning
  - linux
  - reliability
created: 2026-10-17
modified: 2026-10-17
draft: false
---

> [!info] Level: junior-middle | Time: about 6 h | You need: [[learn/text-and-data-tools|Linux 03: Text and data tools]] | Lab: Option A, the Ubuntu LTS VM from [[learn/lab-setup|Start 01: Set up your lab]]

"The server is slow" and "the disk is full" are the two most common pages you will get. Both come down to the same skill: turn a vague feeling into three numbers (CPU, memory, disk and I/O) and find which one is the limit. This lesson is in two parts. **Part 1 (junior)** covers processes: what they are, how to see them, how to stop them. **Part 2 (middle)** covers memory, disk and I/O, and ends with a playbook you can reuse.

## What you will learn

- What a process is and how to inspect one through `ps`, `top` and `/proc`.
- How to read load average against the CPU count, and what process states `R`, `S`, `D`, `T` and `Z` mean.
- How signals work and how to stop a program the way systemd and containers do: TERM, wait, then KILL.
- How to read `free`, swap and the OOM killer without panicking at "used" memory.
- How to find what fills a disk, including deleted-but-open files and exhausted inodes.
- A short USE-method playbook (utilisation, saturation, errors) for a slow or full server.

## Part 1 (junior): processes

### What a process is

A **process** is a running program. The kernel gives each one a **PID** (process ID), records its parent's **PPID**, the **UID** it runs as, and a set of resources: memory, open files and limits. Process 1 is the first process started at boot (usually `systemd`), and every other process descends from it.

The kernel exposes each process as a directory under `/proc/<pid>`. It is not on disk; the kernel generates it when you read it. Three entries are worth knowing:

- `/proc/<pid>/status`: state, parent, user, memory use and thread count in readable form.
- `/proc/<pid>/fd/`: one symlink per open file or socket.
- `/proc/<pid>/limits`: resource limits, including the maximum number of open files.

```bash
sleep 300 &
P=$!
grep -E 'State|PPid|Uid|VmRSS|Threads' /proc/$P/status
ls -l /proc/$P/fd
grep -E 'open files|processes' /proc/$P/limits
```

```text
State:	S (sleeping)
PPid:	24828
Uid:	0	0	0	0
VmRSS:	    1744 kB
Threads:	1
total 0
lr-x------ 1 root root 64 Oct 17 16:33 0 -> /dev/null
l-wx------ 1 root root 64 Oct 17 16:33 1 -> /tmp/output.txt
l-wx------ 1 root root 64 Oct 17 16:33 2 -> /tmp/output.txt
Max processes             64298                64298                processes
Max open files            20000                20000                files
```

_Illustrative: PIDs, users and limits differ per machine._

`VmRSS` is the memory the process holds in RAM right now. The `Uid` line lists the real, effective, saved and filesystem UID. File descriptors 0, 1 and 2 are stdin, stdout and stderr.

### Process states

The `State:` line, and the `STAT` column in `ps`, use a letter:

| Letter | Meaning                                  | What to think                                                                 |
| ------ | ---------------------------------------- | ----------------------------------------------------------------------------- |
| `R`    | Running or runnable (waiting for a CPU). | Counts toward load.                                                           |
| `S`    | Interruptible sleep.                     | Normal: waiting for an event or input.                                        |
| `D`    | Uninterruptible sleep.                   | Waiting on I/O (disk, NFS). Counts toward load. Cannot be killed while stuck. |
| `T`    | Stopped (by a signal or a debugger).     | Paused with `SIGSTOP`; resume with `SIGCONT`.                                 |
| `Z`    | Zombie.                                  | Finished, but its parent has not collected the exit status.                   |

### Listing processes

`ps` shows a snapshot, `top` shows a live view (and `htop`, if installed, is friendlier). Pick your own columns and sort order with `ps -eo`:

```bash
ps -eo pid,ppid,user,stat,%cpu,%mem,rss,etime,comm --sort=-%mem | head -5
```

```text
    PID    PPID USER     STAT %CPU %MEM   RSS     ELAPSED COMMAND
   1822       1 myapp    Ssl   2.1  8.4 683212    05:12:09 java
    931       1 root     Ssl   0.3  1.2  98224    05:12:20 dockerd
   1204       1 postgres Ss    0.1  0.9  72104    05:12:15 postgres
   1480    1204 postgres Ss    0.0  0.5  41020    05:12:14 postgres
```

_Illustrative._

`--sort=-%mem` sorts by memory, biggest first (the `-` reverses). To find a process by name use `pgrep -af nginx` (`-a` prints the full command line, `-f` matches against it). To see which files a process has open, use `lsof -p <pid>`. For a per-process view over time (CPU, memory, disk), `pidstat 1 5` prints five one-second samples; it comes from the `sysstat` package.

### Load average and the CPU count

`uptime` and `top` show three **load averages**: the 1, 5 and 15 minute averages of the number of tasks that were running, waiting for a CPU, or in uninterruptible sleep (state `D`) on Linux. A load number means nothing until you divide by the CPU count.

```bash
nproc
uptime
```

```text
4
 10:22:07 up 5 days,  3:11,  1 user,  load average: 8.12, 6.40, 3.95
```

_Illustrative._

On 4 CPUs, a load of 4 means each CPU always has something to do and nobody waits. A load of 8 means about twice as many tasks as CPUs, on average. But "load 8" alone does not tell you the cause. Look at the CPU idle time: if CPUs are 80% idle with a load of 8, the extra load is not CPU work. It is tasks stuck in `D` state, usually waiting on a slow disk or network filesystem. Load that rises while CPU use stays low points to I/O. See Brendan Gregg's article in the Sources for the history of why Linux counts `D` tasks.

### Signals

A **signal** is a small message sent to a process. A process may handle most signals itself, and the kernel enforces two it cannot be talked out of.

| Signal    | Number | Default effect and common use                                            |
| --------- | ------ | ------------------------------------------------------------------------ |
| `SIGTERM` | 15     | Ask politely to exit. The process can clean up. What `kill <pid>` sends. |
| `SIGKILL` | 9      | The kernel ends it at once. Cannot be caught, no clean-up.               |
| `SIGHUP`  | 1      | Terminal closed. Many daemons reload their config on it.                 |
| `SIGINT`  | 2      | What Ctrl+C sends.                                                       |
| `SIGSTOP` | 19     | Pause. Cannot be caught. (`SIGCONT`, 18, resumes.)                       |

The numbers above are for x86 and Arm Linux; use names (`kill -TERM`) rather than numbers in scripts, since a few differ on other architectures.

### The graceful stop: TERM, wait, KILL

The right order to stop a process is always TERM first, wait, then KILL only if it did not exit. TERM lets the program finish a request, flush data and remove its lock files. KILL skips all that and can leave half-written files. This is what `systemctl stop` does (it sends TERM, waits `TimeoutStopSec`, then KILL), and what Kubernetes does to a pod (TERM, wait the grace period, KILL). You can write the pattern yourself in a few lines:

```bash title="stop_gracefully.sh"
#!/usr/bin/env bash
# Usage: stop_gracefully.sh PID [SECONDS]
# Send TERM, wait up to SECONDS (default 10) for exit, then send KILL.
set -euo pipefail
pid="${1:?usage: $0 PID [SECONDS]}"
wait_s="${2:-10}"

kill -TERM "$pid" 2>/dev/null || { echo "no such process: $pid"; exit 0; }
for ((i = 0; i < wait_s; i++)); do
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "stopped after TERM"
    exit 0
  fi
  sleep 1
done
echo "still running after ${wait_s}s, sending KILL"
kill -KILL "$pid" 2>/dev/null || true
```

`kill -0 <pid>` sends no signal at all. It only checks whether the process exists and you may signal it, which makes it the standard "is it still alive?" test. Change the default `10` to the longest time your service legitimately needs to shut down.

To test the pattern you need a program that ignores TERM. This small script is that trap, and you will use it in the exercises:

```bash title="stubborn.sh"
#!/usr/bin/env bash
trap 'echo "got TERM, ignoring" >&2' TERM
while true; do sleep 1; done
```

### Priority: nice, renice and ionice

When CPUs are busy the scheduler shares time out by **niceness**, from -20 (greediest) to 19 (most polite). Start a batch job politely with `nice -n 10 ./job.sh`, or change a running one with `renice -n 10 -p <pid>`. Ordinary users can only raise niceness (be nicer); lowering it needs root (`CAP_SYS_NICE`). For disk, `ionice -c 3 ./job.sh` runs a command in the idle I/O class, so it only uses the disk when nobody else wants it (the effect depends on the I/O scheduler; verify for your kernel). These are good ways to run a backup without hurting the service.

### Zombies and D state

A **zombie** (`Z`) is a finished process whose parent has not yet called `wait()` to read its exit status. It uses no CPU and no memory, only a slot in the process table. You cannot kill a zombie, because it is already dead. The fix is in the parent: make it reap its children (a bug in the program), restart the parent, or kill the parent so that PID 1 adopts and reaps the zombies. A few zombies for a moment is normal. Thousands means a leaking parent.

```bash
ps -eo pid,ppid,stat,comm | awk '$3 ~ /^Z/'
```

```text
24842 24840 Z    sleep
```

_Illustrative._

The `PPID` column (24840) is the parent you need to look at. A process in **`D` state** is blocked inside the kernel waiting for I/O. A signal, even `kill -9`, is only delivered when it comes back out of that wait, so the process will not die until the I/O completes or fails. If processes are piling up in `D`, fix the thing they wait on (a hung NFS mount, a failing disk), not the processes.

```bash
ps -eo pid,stat,wchan:20,comm | awk '$2 ~ /^D/'
```

`wchan` shows the kernel function the process sleeps in, which is a good hint to the cause.

## Part 2 (middle): memory, disk and I/O

### How Linux uses memory

Linux uses spare RAM as a **page cache**: recently read file data is kept in memory because that makes the next read faster. The kernel gives that memory back instantly when a program needs it. So a healthy, busy server shows little "free" memory and that is normal. The column that answers "how much can programs still get?" is **available**.

```bash
free -h
```

```text
               total        used        free      shared  buff/cache   available
Mem:            15Gi       791Mi        12Gi        14Mi       3.0Gi        14Gi
Swap:             0B          0B          0B
```

_Illustrative._

Judge memory by `available`, not `free`. If `available` is near zero, you have a problem. If `free` is small and `available` is large, you only have a well-used cache.

**Swap** is disk space used as an overflow for memory pages. It buys time, but a machine that is actively swapping gets very slow, because disk is thousands of times slower than RAM. `vmstat 1` shows it in the `si` (swapped in) and `so` (swapped out) columns. Constant non-zero `si`/`so` means the machine is short of memory right now.

```bash
vmstat 1 3
```

```text
 r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st
 0  0      0 12856608 878832 2264804    0    0   275  2876 2220   10 16  6 77  1  1
 0  0      0 12856608 878832 2264848    0    0     0     0  215  170  0  0 100  0  0
```

_Illustrative. The first row is an average since boot, so read the later rows._

`r` is runnable tasks, `b` is tasks blocked in `D`, `wa` is the percentage of CPU time spent waiting on I/O, and `id` is idle.

### The OOM killer

If memory runs out and the kernel cannot reclaim enough, it picks a process and kills it. This is the **OOM killer**, and the victim is often your biggest service, not the program that caused the shortage. It logs the kill in the kernel log:

```bash
sudo dmesg -T | grep -i 'killed process'
sudo journalctl -k --since "1 hour ago" | grep -i 'out of memory'
```

```text
[Fri Oct 17 10:31:55 2026] Out of memory: Killed process 1822 (java) total-vm:7340032kB, anon-rss:683212kB, file-rss:0kB, shmem-rss:0kB, UID:998 pgtables:2164kB oom_score_adj:0
```

_Illustrative: this is not from a real host._

A service that "dies for no reason" with exit status 137 (128 + 9) is often an OOM kill. Always check the kernel log before blaming the application. On a host managed by systemd, you can stop one service from taking all the memory by giving it a limit in the unit file, `MemoryMax=512M`. The kernel's cgroup memory controller then triggers the OOM kill inside that limit and not for the whole machine. Containers use the same mechanism, which is why Kubernetes shows `OOMKilled`; see [[runbooks/kubernetes-pod-troubleshooting]] and [[patterns/kubernetes-resource-requests-and-limits]].

### How disk fills up

A full disk has four common causes. Check them in this order.

**1. Real data.** Find the biggest directories one level at a time, staying on one filesystem (`-x`):

```bash
sudo du -xh --max-depth=1 /var | sort -h | tail -5
```

```text
2.7M	/var/cache
71M	/var/lib
4.1G	/var/log
4.2G	/var
```

_Illustrative._

Repeat inside the biggest directory until you find the culprit. Logs are the usual one. On a systemd host, `journalctl --disk-usage` shows the journal's size and `sudo journalctl --vacuum-size=200M` trims it; for ordinary log files, fix the rotation rather than deleting by hand.

**2. Deleted but still open.** When a process holds a file open and you delete it, the name goes away but the data stays on disk until the last process closes it. `df` still shows the disk as full, and `du` cannot find the space. List such files with `lsof +L1` (files with fewer than one link):

```bash
sudo lsof +L1
```

```text
COMMAND   PID USER   FD   TYPE DEVICE  SIZE/OFF NLINK    NODE NAME
tail    25455 root    3r   REG  254,0 104857600     0 1640171 /tmp/big.bin (deleted)
```

_Illustrative._

The fix is to make the process close the file: restart the service, or, for a log that must keep running, truncate through the descriptor (`: > /proc/<pid>/fd/<n>`). Deleting a huge log file on a running service without restarting it is the classic way to delete nothing.

**3. Inodes.** Every file uses one inode, and a filesystem has a fixed number of them. A directory holding millions of tiny files can use up all inodes while bytes are free. Then `touch` fails with "No space left on device" even though `df -h` shows free space. `df -i` shows inode use:

```bash
df -h /
df -i /
```

```text
Filesystem      Size  Used Avail Use% Mounted on
/dev/vda         40G   31G  7.6G  81% /
Filesystem        Inodes   IUsed    IFree IUse% Mounted on
/dev/vda        16777216  980787 15796429    6% /
```

_Illustrative._

If `IUse%` is near 100, find the directory with the many files (for example `sudo find /var -xdev -type f | cut -d/ -f1-4 | sort | uniq -c | sort -rn | head`) and clear it at the source, such as a cache or mail queue gone wrong.

**4. Reserved blocks.** On ext4, a percentage of the disk (5% by default) is reserved for root, so a data volume can show "0 available" while `Used` is below 100%. That is by design. On a large data-only volume the reserve can be reduced with `tune2fs -m`, but that is a decision to make deliberately, not as an emergency fix; verify the current default for your filesystem and tool version.

### I/O saturation

A disk can be "not full" and still be the bottleneck. `iostat -x 1` (from the `sysstat` package) shows per-device I/O. Look at the utilisation (`%util`) and the average wait (`await` and its per-direction variants; column names vary by version, so verify for yours). A device near 100% util with growing wait times is saturated: requests queue up, and every process that waits on it shows state `D`. In `vmstat`, a high `wa` and a high `b` say the same.

### The USE-method playbook

Brendan Gregg's **USE method** says: for every resource, check **U**tilisation (how busy), **S**aturation (how much work is waiting) and **E**rrors. Apply it in order to a slow server:

| Resource   | Utilisation                    | Saturation                             | Errors                    |
| ---------- | ------------------------------ | -------------------------------------- | ------------------------- |
| CPU        | `top`, `vmstat us+sy`          | load average above `nproc`, `vmstat r` | rarely visible            |
| Memory     | `free -h` (available)          | swapping (`si`, `so`), OOM kills       | `dmesg` OOM lines         |
| Disk       | `iostat -x` (`%util`), `df -h` | queue length and await, `vmstat b`     | `dmesg` I/O errors, SMART |
| Disk space | `df -h`, `df -i`               | writes failing                         | "No space left on device" |

Work through the rows. In a few minutes you usually know which resource is the limit, and that tells you whether to look at one process, the kernel log or the storage. For the next layer of this problem on Kubernetes nodes, see [[runbooks/node-resource-pressure-triage]].

## Hands-on exercises

Run these in the lab VM. Some commands need `sudo` and some tools (`iostat`, `pidstat`, `lsof`) come from packages: `sudo apt install -y sysstat lsof`. Output is illustrative where PIDs, sizes and times differ.

**Part 1**

1. **Inspect a process in /proc.** Run the `sleep 300 &` block from the lesson.
   Expected: `State: S (sleeping)`, a `PPid`, three `fd` links, and a limits line for open files.
   If you see something else: if `/proc/$P` does not exist, the `sleep` exited. Check that the command ended with `&` and that `$P` is set (`echo $P`).

2. **Build your own ps view.** Run `ps -eo pid,ppid,user,stat,%cpu,%mem,rss,etime,comm --sort=-%mem | head -5`, then `pgrep -af sleep`.
   Expected: a table sorted by memory, then the line with your `sleep 300` and its PID.
   If you see something else: `pgrep` printing nothing means the `sleep` ended. Start another.

3. **Compare load with CPUs.** Run `nproc` and `uptime`. Then in one terminal run `for i in $(seq "$(nproc)"); do (while :; do :; done) & done`, wait a minute, and run `uptime` again.
   Expected: the 1-minute load rises towards the CPU count. Stop the busy loops with `kill $(jobs -p)`.
   If you see something else: if load stays near 0, wait longer; the 1-minute average moves slowly. `top` will show the loops at near 100% CPU straight away.

4. **The trap: TERM does not kill it.** Save `stubborn.sh`, make it executable, and run it in the background. Then:

   ```bash
   chmod +x stubborn.sh stop_gracefully.sh
   ./stubborn.sh &
   S=$!
   kill -TERM "$S"
   sleep 2
   ps -p "$S" -o pid,stat,comm
   ```

   Expected: `got TERM, ignoring` printed once, and `ps` still lists the process.
   If you see something else: if the process is gone, the `trap` line was not saved. Check the script.

5. **Use the graceful-stop helper.** Run `./stop_gracefully.sh "$S" 3`.
   Expected: `still running after 3s, sending KILL`, and afterwards `ps -p "$S"` lists nothing.
   If you see something else: if you see `no such process`, you already stopped it in exercise 4. Start a new `./stubborn.sh &` first. Then try the helper on a normal program (`sleep 100 &`) and expect `stopped after TERM`.

6. **Make and see a zombie.** Run:

   ```bash
   bash -c 'sleep 0.1 & exec sleep 30' &
   sleep 1
   ps -eo pid,ppid,stat,comm | awk '$3 ~ /^Z/'
   ```

   Expected: one line with state `Z`. Its PPID is the process running `sleep 30`, which never reaps it.
   If you see something else: no output means the child was reaped. Run the `ps` line again within 30 seconds, because the zombie only exists while the parent runs. The zombie disappears when you run `pkill -f 'sleep 30'`.

**Part 2**

7. **Read memory the right way.** Run `free -h` and `vmstat 1 3`.
   Expected: `Mem` and `Swap` rows with an `available` column, and `si`/`so` of `0` on an idle lab VM.
   If you see something else: if `Swap` shows `0B` you have no swap, which is common on cloud images and fine for this exercise.

8. **Trigger an OOM kill inside a limit.** This needs systemd and cgroup v2, so it is not verified here. Run:

   ```bash
   sudo systemd-run --scope -p MemoryMax=100M python3 -c 'x = bytearray(500 * 1024 * 1024); print("allocated")'
   echo "exit=$?"
   sudo dmesg -T | grep -i 'killed process' | tail -1
   ```

   Expected: `Killed`, `exit=137`, and an OOM line naming `python3`. The limit applies to the scope, not the whole VM.
   If you see something else: if it prints `allocated`, the limit was not applied (cgroup v1 or a container without delegation). Use a full VM, not a Docker container, for this exercise. If your VM has swap, the process may be swapped instead; add `-p MemorySwapMax=0`.

9. **Find what fills a disk.** Run `sudo du -xh --max-depth=1 /var | sort -h | tail -5`.
   Expected: the biggest directories last, with `/var` itself at the bottom.
   If you see something else: `Permission denied` lines mean you left out `sudo`; run it again with `sudo`.

10. **Delete a file that does not free space.** Run:

    ```bash
    dd if=/dev/zero of=/tmp/big.bin bs=1M count=500
    df -h /tmp
    tail -f /tmp/big.bin > /dev/null &
    T=$!
    sleep 1
    rm /tmp/big.bin
    df -h /tmp
    sudo lsof +L1 | grep big.bin
    kill "$T"
    sleep 1
    df -h /tmp
    ```

    Expected: `Used` goes up by about 500M after `dd`, stays the same after `rm`, `lsof +L1` lists `/tmp/big.bin (deleted)`, and `Used` drops after `kill`.
    If you see something else: if `Used` drops right after `rm`, `/tmp` is probably a RAM-backed `tmpfs` on your system, or `tail` had not opened the file yet (a `tmpfs` also keeps a deleted file while it is open, so this is the likelier cause). Check with `df /tmp`, repeat with the `sleep 1` in place, and use `/var/tmp` if `/tmp` is a `tmpfs`.

11. **Write the disk-100% runbook.** Using the four causes above, write a six-line checklist in `~/lab04/disk-full.md` that a colleague could follow at 3 a.m. Each line is a command and what the output means.
    Expected: your checklist starts with `df -h` and `df -i`, then `du -xh --max-depth=1`, then `lsof +L1`, and says what to do for each result.
    If you see something else: if a step does not say what to do on a positive result, add it. A runbook with only commands is not finished. Compare with [[runbooks/node-resource-pressure-triage]].

12. **Spot I/O wait.** In one terminal run `iostat -x 1` (or `vmstat 1`). In another run `dd if=/dev/zero of=/var/tmp/io.bin bs=1M count=2000 oflag=dsync`.
    Expected: `%util` and `wa` rise while `dd` runs; stop with Ctrl+C if it takes too long, then `rm /var/tmp/io.bin`.
    If you see something else: on a fast virtual disk the rise can be small. A short burst is normal. If `iostat` is missing, install `sysstat`.

Clean up: `kill $(jobs -p) 2>/dev/null; rm -f /tmp/big.bin /var/tmp/io.bin`.

## Common mistakes

- **Reaching for `kill -9` first.** It skips clean-up, so you can leave corrupt files and stale locks. Send TERM, wait, then KILL.
- **Reading `free` memory as a problem.** A small `free` with a large `available` is a healthy cache. Judge by `available` and by swapping.
- **Treating load as CPU use.** Load includes tasks in `D` state. Compare with CPU idle time and `vmstat b` before adding CPUs.
- **Deleting a log file on a running service and expecting space back.** The process still holds it. Use `lsof +L1`, then restart the service or truncate the open file.
- **Checking only `df -h`.** A full-inode filesystem also says "No space left on device". Run `df -i` too.
- **Trying to kill a zombie, or a process in `D` state.** A zombie is already dead, and a `D` process only dies when its I/O returns. Fix the parent, or fix the slow storage.
- **Blaming the application for a 137 exit.** Check the kernel log first for an OOM kill.
- **Running `du` without `-x` on `/`.** It crosses into other filesystems and `/proc`, takes forever and misleads. Use `-x` and start low.

## Check your understanding

1. A server shows load average 8 on 4 CPUs, but the CPUs are 80% idle. What does that suggest, and what do you check next?
2. Why can `kill -9` not stop a process in `D` state?
3. You delete a 10 GB log with `rm`, but `df` still shows the disk full. Why, and how do you find and fix it?
4. On `free -h`, `free` is 200Mi but `available` is 6Gi. Should you worry?
5. Why must a process be sent TERM before KILL, and what do systemd and Kubernetes do with that order?
6. A `touch` fails with "No space left on device" and `df -h` shows 40% used. What do you check?

> [!question]- Answers
>
> 1. The extra load is not CPU work: it is probably tasks in `D` state waiting on I/O. Check `vmstat 1` (`b` and `wa`), `iostat -x` and `ps` for `D` processes, and look at the storage or network filesystem they wait on.
> 2. A signal is delivered when the process leaves the kernel wait. A `D` process is blocked inside the kernel on I/O, so the kill stays pending until the I/O completes or fails. Fix what it is waiting on.
> 3. A process still holds the deleted file open, so the kernel keeps the data until it closes it. Find it with `lsof +L1`, then restart that service or truncate the file through `/proc/<pid>/fd/<n>`.
> 4. No. The kernel is using spare RAM as page cache and gives it back on demand. `available` is the figure that matters. Worry when `available` is low or the machine swaps.
> 5. TERM lets the program clean up and finish work, and KILL cannot be caught. `systemctl stop` sends TERM, waits `TimeoutStopSec`, then KILL. Kubernetes sends TERM, waits the termination grace period, then KILL.
> 6. Inodes: run `df -i`. A filesystem with millions of small files can run out of inodes while bytes are free. Find the directory with the many files and clear it at the source.

## Next steps

Next lesson: Linux 05, [[learn/linux-services-packages-and-scheduled-jobs|Services, packages and scheduled jobs]]. Previous lesson: [[learn/text-and-data-tools|Linux 03: Text and data tools]].

To go deeper:

- [[runbooks/kubernetes-pod-troubleshooting]] for OOMKilled and eviction on Kubernetes.
- [[patterns/kubernetes-resource-requests-and-limits]] for how memory and CPU limits map to the cgroup limits you met here.
- [[runbooks/node-resource-pressure-triage]] for the node-level version of this playbook.
- The whole path is mapped in [[learn/index|the learning path]].

## Sources

- `man 5 proc`, `man 7 signal`, `man 1 ps`, `man 8 lsof` (Linux man-pages project, https://man7.org/linux/man-pages/). The `/proc`, `ps`, signal, zombie, deleted-file and `df` examples were run on Ubuntu 24.04 LTS.
- Linux kernel documentation on memory management and the OOM killer (https://docs.kernel.org/admin-guide/mm/index.html). Not re-run: the OOM log line is illustrative and exercise 8 is not verified.
- `man 5 systemd.resource-control` for `MemoryMax` (https://www.freedesktop.org/software/systemd/man/). Not verified on this lab; systemd 255 was present on the machine used.
- Brendan Gregg, "Linux Load Averages: Solving the Mystery" (https://www.brendangregg.com/blog/2017-08-08/linux-load-averages.html) and "The USE Method" (https://www.brendangregg.com/usemethod.html).
