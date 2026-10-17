---
title: "Networking 02: IP addressing and subnets from zero"
description: Learn IPv4 addresses, CIDR prefixes, subnet maths, private ranges and routing, plan a VPC and GKE ranges with room to grow, and meet IPv6.
type: guide
tags:
  - learning
  - networking
  - gcp
created: 2026-10-17
modified: 2026-10-17
draft: false
---

> [!info] Level: junior | Time: about 4 h | You need: [[learn/network-layers-tcp-and-udp|Networking 01: Layers, TCP, UDP and ports]] | Lab: Option A, the Ubuntu LTS VM from [[learn/lab-setup|Start 01: Set up your lab]] (the exercises only need `python3`, so any lab option works)

Every cloud network design starts with a table of address ranges, and nearly every awkward networking outage in a growing company traces back to a range that was too small, or that overlapped with another one. Subnet maths looks like a trick, but it is only binary counting. This lesson builds it from the bits, then applies it to the job you will really do: planning ranges for a VPC and a GKE cluster that must still fit in three years.

## What you will learn

- How an IPv4 address is 32 bits, and how a prefix (CIDR) splits it into a network part and a host part.
- How to find the network address, broadcast address and usable hosts of any subnet, by hand and with Python.
- Which ranges are private, loopback, link-local or shared (CGNAT), and why it matters.
- How a host decides where to send a packet (the routing table and the longest prefix).
- How to split a block into subnets, and how to plan VPC and GKE ranges without overlaps.
- The basics of IPv6 notation and why a `/64` is the usual subnet size.

## An address is 32 bits

An IPv4 address is a 32-bit number. People write it as four **octets** (8-bit groups) in decimal, separated by dots, so each octet is 0 to 255:

```text
192       .168      .10       .77
11000000  .10101000 .00001010 .01001101
```

To convert one octet to binary, write the place values `128 64 32 16 8 4 2 1` and mark which ones add up to the number. For 77: `64 + 8 + 4 + 1 = 77`, so the bits are `01001101`.

## Prefix, netmask and wildcard

An address has two parts: the **network** part, which names the network, and the **host** part, which names a device in it. A **prefix length** says where the split is. In **CIDR** notation (Classless Inter-Domain Routing, RFC 4632) you write it after a slash: `192.168.10.77/27` means "the first 27 bits are the network, the last 5 bits are the host".

The same split can be written as a **netmask**: 27 one-bits followed by 5 zero-bits.

```text
/27 netmask   11111111.11111111.11111111.11100000  =  255.255.255.224
wildcard mask 00000000.00000000.00000000.00011111  =  0.0.0.31
```

The **wildcard mask** is the netmask with every bit flipped. You will meet it in some router and firewall syntaxes. For daily work the slash form is shorter and clearer.

Common prefixes in the last octet region:

| Prefix | Netmask         | Addresses | Block size in the interesting octet |
| ------ | --------------- | --------- | ----------------------------------- |
| /24    | 255.255.255.0   | 256       | 256                                 |
| /25    | 255.255.255.128 | 128       | 128                                 |
| /26    | 255.255.255.192 | 64        | 64                                  |
| /27    | 255.255.255.224 | 32        | 32                                  |
| /28    | 255.255.255.240 | 16        | 16                                  |
| /29    | 255.255.255.248 | 8         | 8                                   |
| /30    | 255.255.255.252 | 4         | 4                                   |

Each step of one bit halves the block. The number of addresses is `2^(32 - prefix)`.

## Network, broadcast and usable hosts

In a classic subnet, two addresses are special:

- the **network address**, where all host bits are 0, names the subnet itself;
- the **broadcast address**, where all host bits are 1, addresses every host in the subnet.

The hosts live between them, so a subnet with `h` host bits has `2^h - 2` usable addresses. A `/24` has 8 host bits: 256 addresses, 254 usable. A `/28` has 4 host bits: 16 addresses and 14 usable.

Two exceptions are defined by standards: **`/31`** subnets have two addresses and no network or broadcast address, and are used on point-to-point links (RFC 3021). **`/32`** is a single address: it names one host, for example in a firewall rule, a route to one machine or a loopback address.

### Worked example: 192.168.10.77/27

Let us find the subnet that holds `192.168.10.77/27`, by hand.

1. The prefix is 27, so the first three octets (24 bits) are fully in the network part and the fourth octet has 3 network bits and 5 host bits.
2. The 4th octet is 77 = `01001101`. Keep the first 3 bits, zero the last 5: `01000000` = 64. The **network address** is `192.168.10.64`.
3. Set the 5 host bits to 1: `01011111` = 95. The **broadcast address** is `192.168.10.95`.
4. Usable hosts run from `.65` to `.94`: `2^5 - 2 = 30` addresses.

A faster method for the interesting octet: the **block size** is `256 - 224 = 32` (the mask octet is 224). The subnets start at multiples of 32: 0, 32, 64, 96... 77 lies between 64 and 96, so the network is `.64`, the next network starts at `.96`, and the broadcast is `.95`.

Check it with Python's standard library, which is installed almost everywhere:

```bash
python3 -c "
import ipaddress as i
n = i.ip_interface('192.168.10.77/27').network
print(n, n.netmask, n.hostmask, n.broadcast_address, n.num_addresses - 2)
"
```

```text
192.168.10.64/27 255.255.255.224 0.0.0.31 192.168.10.95 30
```

## Special ranges

Not every address is meant to cross the internet. The ones to know:

| Range                                         | Name                         | Defined in | What it is for                                                                               |
| --------------------------------------------- | ---------------------------- | ---------- | -------------------------------------------------------------------------------------------- |
| 10.0.0.0/8                                    | Private                      | RFC 1918   | Internal networks, free for anyone to reuse                                                  |
| 172.16.0.0/12                                 | Private                      | RFC 1918   | Internal networks (172.16.0.0 to 172.31.255.255)                                             |
| 192.168.0.0/16                                | Private                      | RFC 1918   | Internal networks, typically small and home networks                                         |
| 127.0.0.0/8                                   | Loopback                     | RFC 1122   | The machine itself (`127.0.0.1`, `localhost`)                                                |
| 169.254.0.0/16                                | Link-local                   | RFC 3927   | Self-assigned when DHCP fails; also used for special services such as cloud metadata servers |
| 100.64.0.0/10                                 | Shared address space (CGNAT) | RFC 6598   | Used by internet providers between their customers and their NAT devices                     |
| 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 | Documentation                | RFC 5737   | Examples in books and notes. Never assign these to real hosts                                |

Because the private ranges are reused by everyone, two private networks that you connect (a VPN, VPC peering, a company merger) must not use the same ranges. That is the source of the most important design rule in this lesson, covered below.

**Is 100.64.0.0/10 private?** It is not one of the three RFC 1918 ranges, and it is not globally routable either; RFC 6598 calls it shared address space. Python's `ipaddress` module reflects that: `ip_address('100.64.1.1').is_private` and `.is_global` both return `False` in the Python 3.13 used while writing this lesson. Its value in practice is that it is unlikely to collide with the RFC 1918 ranges inside your company, but it may collide with a provider's CGNAT network, so check before using it, for example for VPN or Kubernetes pod ranges.

## Where does a packet go? Gateways and routes

A host decides where to send each packet with its **routing table**. The rule is **longest prefix match**: among all routes whose network contains the destination, the most specific one (the longest prefix) wins.

```bash
ip route show
ip route get 198.51.100.7
```

Illustrative output on a lab VM:

```text
default via 192.0.2.1 dev enp0s3 proto dhcp src 192.0.2.50 metric 100
192.0.2.0/24 dev enp0s3 proto kernel scope link src 192.0.2.50
198.51.100.7 via 192.0.2.1 dev enp0s3 src 192.0.2.50 uid 1000
    cache
```

Read it like this. `192.0.2.0/24 dev enp0s3 ... scope link` says: addresses in this subnet are on the local link, so send directly (resolve the neighbour with ARP). `default via 192.0.2.1` is the route `0.0.0.0/0`, the shortest possible prefix, which matches everything else, so it is used only when nothing more specific matches. `ip route get` asks the kernel which route a particular destination would use. The next hop `192.0.2.1` is the **default gateway**, a router on your subnet that forwards packets onward.

Python can show the same decision rule with two routes:

```bash
python3 -c "
import ipaddress as i
routes = {'default': i.ip_network('0.0.0.0/0'),
          'corp':    i.ip_network('10.0.0.0/8'),
          'dev-vpn': i.ip_network('10.20.0.0/16')}
dst = i.ip_address('10.20.3.9')
match = [(n.prefixlen, k) for k, n in routes.items() if dst in n]
print(sorted(match, reverse=True)[0][1])
"
```

```text
dev-vpn
```

All three routes match `10.20.3.9`, and `dev-vpn` wins as the longest prefix.

## Splitting and aggregating

Splitting a block into smaller subnets means adding bits to the prefix. A `/24` split into `/26` subnets gives four blocks of 64:

```bash
python3 -c "
import ipaddress as i
for s in i.ip_network('10.20.0.0/24').subnets(new_prefix=26): print(s)
"
```

```text
10.20.0.0/26
10.20.0.64/26
10.20.0.128/26
10.20.0.192/26
```

**Aggregation** is the reverse: adjacent, aligned blocks combine into one shorter prefix. `10.20.0.0/24` and `10.20.1.0/24` aggregate into `10.20.0.0/23`. Aggregation keeps routing tables and firewall rules short, but it only works if you allocated the blocks next to each other and aligned to their size. This is another reason to plan ranges instead of handing out the next free one.

```bash
python3 -c "
import ipaddress as i
print(list(i.collapse_addresses([i.ip_network('10.20.0.0/24'), i.ip_network('10.20.1.0/24')])))
"
```

```text
[IPv4Network('10.20.0.0/23')]
```

## Planning a VPC and GKE ranges

On Google Cloud, a **VPC network** is global and holds **subnets**, each of which belongs to a single region. Each subnet has a **primary range** for VM and node addresses, and may have **secondary ranges**. A GKE cluster that uses VPC-native networking takes its **Pod** addresses and its **Service** (cluster IP) addresses from secondary ranges of a subnet, so you must plan three kinds of range, not one. See [[learn/gcp-vpc-compute-and-cloud-sql|GCP 03]] for the cloud side and [[learn/gke-for-beginners|GCP 04]] for GKE.

Rules to plan by:

1. **Never overlap** with anything you might connect to: other VPCs (peering), on-premises networks (VPN or Interconnect), a partner network, a developer's laptop VPN. Two overlapping ranges cannot be peered or routed (see the exercises). Keep one table of every range in use, owned by one team.
2. **Size for growth.** Changing a range later means rebuilding or migrating. Google Cloud lets you expand a subnet's primary range but not shrink it (verify the current rules in the documentation), and secondary ranges used by a GKE cluster are much harder to change. Take more than you need today.
3. **Allocate on boundaries** so that environments and regions aggregate neatly into one prefix for firewall rules and routes.
4. **Pods are the big consumer.** Each node gets a slice of the Pod range for its Pods. The slice size and the maximum Pods per node depend on GKE settings and version (verify in the GKE documentation), so compute the maximum node count from your slice size before you pick the Pod range.
5. **Leave unallocated space.** A spare block per environment is cheap now and costly to find later.

A small plan for three environments, from the parent block `10.16.0.0/12` (nodes in `10.20.0.0/14`, Pods in `10.24.0.0/14`, Services in `10.28.0.0/18`) (the numbers are an example you should adapt, not a standard):

| Environment | Nodes (primary range) | Pods (secondary) | Services (secondary) |
| ----------- | --------------------- | ---------------- | -------------------- |
| dev         | 10.20.0.0/22          | 10.24.0.0/16     | 10.28.0.0/20         |
| stage       | 10.20.4.0/22          | 10.25.0.0/16     | 10.28.16.0/20        |
| prod        | 10.20.8.0/22          | 10.26.0.0/16     | 10.28.32.0/20        |
| spare       | 10.20.12.0/22         | 10.27.0.0/16     | 10.28.48.0/20        |

A `/22` of nodes is 1,024 addresses, a `/16` of Pods is 65,536 and a `/20` of Services is 4,096. If each node were given a `/24` slice of Pods (an example, not necessarily your setting), a `/16` Pod range would allow `2^(24-16) = 256` nodes. Check that number against the cluster size you expect.

> [!warning] Check before relying on this
> **How many addresses does a cloud subnet keep for itself?** In a Google Cloud subnet's primary range, four addresses are reserved: the network address, the default gateway (the first usable address, network plus 1), the second-to-last address and the broadcast address. So a `/28` has 16 addresses and 12 usable ones. AWS reserves five addresses in each subnet. Both statements are from the lesson author's reading and were not re-checked against current documentation while writing; verify them in the current Google Cloud "subnets" documentation and the AWS VPC documentation before you size anything close to the limit. Also check the **minimum and maximum** subnet sizes and any extra reserved addresses for the services you use (GKE, Cloud SQL private services access, load balancer proxy-only subnets).

## IPv6 in one section

IPv4 has about 4.3 billion addresses and the world ran out. **IPv6** addresses are 128 bits, written as eight groups of four hexadecimal digits separated by colons:

```text
2001:0db8:0000:0000:0000:0000:0000:0001
```

Two rules shorten them: drop leading zeros in a group, and replace **one** run of all-zero groups with `::`. The address above becomes `2001:db8::1`. (`2001:db8::/32` is the range reserved for documentation, like `192.0.2.0/24` for IPv4.)

The prefix works like CIDR. A standard end-user or server **subnet is a `/64`**: the first 64 bits are the network and the last 64 the interface. A `/64` holds 2^64 addresses, so you do not count hosts or conserve addresses; you plan the hierarchy of prefixes instead (a site gets a `/48` or `/56`, each subnet takes a `/64`). Link-local addresses start with `fe80::/10`, and `::1` is the loopback.

```bash
python3 -c "
import ipaddress as i
print(i.ip_address('2001:0db8:0000:0000:0000:0000:0000:0001').compressed)
print(i.ip_network('2001:db8:1:2::/64').num_addresses == 2**64)
"
```

```text
2001:db8::1
True
```

## Tools

- **Python's `ipaddress`** (standard library) as used in this lesson. It is in every Python 3 install, and gives you the same answer on every platform.
- **`ipcalc`**, a small command (`sudo apt install ipcalc`) that prints the network, broadcast, host range and binary form for an address and prefix. Its output format differs between versions and between the Debian and Red Hat variants, so use it for a quick look, not as a script input (verify for your version).
- **`ip route get`** to see what your host would do with a destination.

## Hands-on exercises

Run these in your lab. Everything here is safe: it only does arithmetic, except the `ip` commands, which only read. Outputs for the Python commands come straight from the module (they do not vary by machine); the `ip` output is illustrative.

1. **Subnet 192.168.10.77/27 by hand, then check.** On paper write the 4th octet in binary, find the network, broadcast and the number of usable hosts. Then run the Python snippet from the worked example.
   Expected: network `192.168.10.64`, broadcast `192.168.10.95`, 30 usable hosts, netmask `255.255.255.224`.
   If you see something else: if your paper answer differs, redo the step "keep the first 3 bits, zero the last 5" for `01001101`. The most common slip is using the whole octet instead of the host bits.

2. **Size a block with one line.** Run:

   ```bash
   python3 -c "import ipaddress as i; n=i.ip_network('10.20.0.0/22'); print(n[0], n[-1], n.num_addresses)"
   ```

   Expected: `10.20.0.0 10.20.3.255 1024`.
   If you see something else: if the second address is `10.20.0.255`, you wrote `/24`. A `/22` spans four /24 blocks (third octet 0 to 3).

3. **Split a /24 into /26 subnets.** Run:

   ```bash
   python3 -c "
   import ipaddress as i
   for s in i.ip_network('10.20.0.0/24').subnets(new_prefix=26): print(s, s.num_addresses)
   "
   ```

   Expected: four lines: `10.20.0.0/26 64`, `10.20.0.64/26 64`, `10.20.0.128/26 64`, `10.20.0.192/26 64`.
   If you see something else: `ValueError: new prefix must be longer` means the new prefix number is smaller than the current one. Subnetting makes the prefix number bigger.

4. **Test membership and overlap.** Run:

   ```bash
   python3 -c "
   import ipaddress as i
   print(i.ip_address('10.20.0.5') in i.ip_network('10.20.0.0/22'))
   print(i.ip_network('10.0.0.0/16').overlaps(i.ip_network('10.0.128.0/17')))
   print(i.ip_network('10.0.0.0/16').overlaps(i.ip_network('10.1.0.0/16')))
   "
   ```

   Expected: `True`, `True`, `False`. The `/17` starting at `10.0.128.0` is the upper half of `10.0.0.0/16`, so the two overlap, and two VPCs with those ranges could not be peered, because a router would not know which one an address such as `10.0.130.4` belongs to.
   If you see something else: `ValueError: ... has host bits set` means you gave an address that is not the start of the block, for example `10.0.130.0/17`. Use `strict=False` or the correct network address.

5. **Classify special addresses.** Run:

   ```bash
   python3 -c "
   import ipaddress as i
   for a in ['10.0.0.1','127.0.0.1','169.254.1.1','100.64.1.1','203.0.113.5','8.8.8.8']:
       x = i.ip_address(a)
       print(a, 'private' if x.is_private else '-', 'global' if x.is_global else '-', 'linklocal' if x.is_link_local else '-')
   "
   ```

   Expected: `10.0.0.1` private, `127.0.0.1` private (loopback counts as private in this module), `169.254.1.1` private and linklocal, `100.64.1.1` neither private nor global, `203.0.113.5` private (documentation range) and not global, `8.8.8.8` global. The exact classification of edge ranges is defined by the Python version, so treat this as an example (Python 3.13 gave `100.64.1.1` as neither private nor global).
   If you see something else: another Python version may classify ranges differently. Compare with the table in this lesson, which follows the RFCs.

6. **Read your routing table.** Run:

   ```bash
   ip route show
   ip route get 198.51.100.7
   ip route get 127.0.0.1
   ```

   Expected: a `default via ...` line plus a connected-subnet line; for `198.51.100.7` a line starting `198.51.100.7 via <your gateway> dev <interface>`; for `127.0.0.1` a `local 127.0.0.1 dev lo` line.
   If you see something else: if `ip route get` says `RTNETLINK answers: Network is unreachable`, the VM has no default route (see [[learn/network-layers-tcp-and-udp|Networking 01]], exercise 1).

7. **Plan a small VPC on paper, then check it with code.** For three environments (dev, stage, prod), write one table with node, Pod and Service ranges like the one in this lesson but with your own numbers and with a spare block. Then paste your ranges into this checker and run it:

   ```bash
   python3 - <<'PY'
   import ipaddress as i, itertools
   plan = {
       "nodes-dev":   "10.20.0.0/22",
       "nodes-stage": "10.20.4.0/22",
       "nodes-prod":  "10.20.8.0/22",
       "pods-dev":    "10.24.0.0/16",
       "pods-stage":  "10.25.0.0/16",
       "pods-prod":   "10.26.0.0/16",
       "svc-dev":     "10.28.0.0/20",
       "svc-stage":   "10.28.16.0/20",
       "svc-prod":    "10.28.32.0/20",
   }
   nets = {k: i.ip_network(v) for k, v in plan.items()}
   clashes = [(a, b) for a, b in itertools.combinations(nets, 2) if nets[a].overlaps(nets[b])]
   print("overlaps:", clashes or "none")
   for k, n in nets.items():
       print(f"{k:12} {str(n):16} {n.num_addresses}")
   PY
   ```

   Expected: `overlaps: none` and nine rows with the sizes `1024`, `65536` and `4096`.
   If you see something else: any pair listed under `overlaps:` shows the two ranges to move. Change one, and run again until it prints `none`. Replace the example numbers with ranges that do not clash with your home or office network (check `ip route`).

8. **Compute the usable hosts, then verify the cloud rule.** For a `/28`: how many usable hosts in a classic subnet, and how many in a Google Cloud subnet if four addresses are reserved? Then open the current Google Cloud subnet documentation and confirm the reserved-address rule.
   Expected: 14 classic usable addresses (`16 - 2`) and 12 in a Google Cloud primary range (`16 - 4`), provided the documentation still says four are reserved.
   If you see something else: if the documentation lists different reserved addresses or a different count, trust the documentation and correct your table. This lesson marks the rule as not verified.

## Common mistakes

- **Counting hosts as `2^h` and forgetting the reserved addresses.** A `/28` in a cloud has fewer usable addresses than 16, and a subnet planned to the exact number of nodes has no room for upgrades (GKE adds temporary nodes during surge upgrades). Fix: size with a margin and subtract what the platform reserves.
- **Choosing ranges at random from `10.0.0.0/8`.** Everyone picks `10.0.0.0/16` or `10.1.0.0/16`, so these collide later with a VPN or a partner. Fix: keep one allocation table and pick uncommon ranges on proper boundaries.
- **Overlapping ranges between VPCs, regions or sites.** Peering and routing fail, or worse, traffic goes to the wrong place. Fix: run the overlap check on every new range before you create anything.
- **Choosing a Pod or Service range that is too small.** It cannot be changed easily later. Fix: compute the maximum node and Service count and choose the bigger prefix now.
- **Reading `10.0.0.0/8` as a single host or `/32` as a network.** A `/32` is one address; `0.0.0.0/0` is every address. Fix: say the count aloud: `2^(32 - prefix)`.
- **Assuming `100.64.0.0/10` is the same as RFC 1918.** It is shared address space with its own rules and possible collisions with a provider's network. Fix: check before you use it, and document the choice.
- **Using real, public addresses in examples and configs.** They might belong to someone else. Fix: use the documentation ranges `192.0.2.0/24`, `198.51.100.0/24` and `203.0.113.0/24` in examples.

## Check your understanding

1. How many usable host addresses are in a classic `/28` subnet? How many would a cloud that reserves four addresses give you?
2. Why can two VPCs with overlapping CIDR ranges not be peered?
3. Is `100.64.0.0/10` a private range? What is it used for?
4. What does `203.0.113.10/32` mean in a firewall rule, and what does `0.0.0.0/0` mean?
5. A host has routes `default via 192.0.2.1`, `10.0.0.0/8 via 192.0.2.2` and `10.20.0.0/16 via 192.0.2.3`. Which route does a packet to `10.20.3.9` use, and why?
6. Which subnet does `192.168.10.200/26` belong to, and what are its network and broadcast addresses?

> [!question]- Answers
>
> 1. A `/28` has 16 addresses, so `16 - 2 = 14` usable in a classic subnet (network and broadcast removed). A cloud that reserves four addresses gives `16 - 4 = 12`. (Verify the reserved count for your cloud; this lesson marks it as not verified.)
> 2. A router (or the peering) would see the same addresses on both sides and could not tell which network an address belongs to, so it cannot decide where to send a packet. Peering systems refuse overlapping ranges for that reason.
> 3. No, it is not one of the RFC 1918 private ranges. RFC 6598 defines it as shared address space, used by internet providers between their customer equipment and their carrier-grade NAT. It is not globally routable, and it may collide with a provider's own use, so check before using it.
> 4. `/32` means exactly one address, so the rule applies to that single host. `0.0.0.0/0` means every IPv4 address. Be careful with `0.0.0.0/0` in a firewall allow rule.
> 5. The route through `192.0.2.3`, because all three routes contain `10.20.3.9` and the longest prefix (`/16`) wins over `/8` and `/0`.
> 6. A `/26` has blocks of 64: 0, 64, 128, 192. 200 lies in the block starting at 192, so the network is `192.168.10.192/26`, the broadcast is `192.168.10.255` and the usable range is `.193` to `.254`.

## Next steps

Next lesson: [[learn/dns-resolution|Networking 03: DNS resolution end to end]]. Previous lesson: [[learn/network-layers-tcp-and-udp|Networking 01: Layers, TCP, UDP and ports]]. You will use this lesson again when you build a network on Google Cloud in [[learn/gcp-vpc-compute-and-cloud-sql|GCP 03: VPC networking, Compute Engine and private Cloud SQL]].

For going deeper as a senior engineer:

- [[runbooks/network-troubleshooting-dns-mtu-tls-load-balancers]] for the troubleshooting order once the addressing is correct.
- [[runbooks/hybrid-connectivity-bgp-troubleshooting]] for what overlapping or missing ranges look like on VPN and Interconnect links.
- [[patterns/kubernetes-network-policies]] for controlling which Pod ranges may talk to each other.
- The whole path is mapped in [[learn/index|the learning path]].

## Sources

- RFC 4632, Classless Inter-domain Routing (CIDR) (https://www.rfc-editor.org/rfc/rfc4632), RFC 1918, Address Allocation for Private Internets (https://www.rfc-editor.org/rfc/rfc1918), RFC 3021, Using 31-Bit Prefixes on IPv4 Point-to-Point Links (https://www.rfc-editor.org/rfc/rfc3021), RFC 6598, IANA-Reserved IPv4 Prefix for Shared Address Space (https://www.rfc-editor.org/rfc/rfc6598), RFC 5737, IPv4 Address Blocks Reserved for Documentation (https://www.rfc-editor.org/rfc/rfc5737) and RFC 3927 for link-local addresses (https://www.rfc-editor.org/rfc/rfc3927).
- Python documentation for the `ipaddress` module (https://docs.python.org/3/library/ipaddress.html). The Python outputs in this lesson were run on Python 3.13.16 (not the system `python3` of Ubuntu 24.04, which is 3.12, so edge-range results can differ there), except where the text says illustrative. `ip route` output was not run in the lab and is illustrative.
- Google Cloud documentation: VPC subnets and IP addresses, and GKE VPC-native clusters and IP address ranges (https://cloud.google.com/vpc/docs/subnets). Not verified: the reserved-address count, subnet size limits, and the per-node Pod slice settings. Check the version you use.
- AWS VPC documentation on subnet sizing (https://docs.aws.amazon.com/vpc/), only for the comparison of reserved addresses. Not verified.
