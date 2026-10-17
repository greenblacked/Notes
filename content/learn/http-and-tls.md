---
title: "Networking 04: HTTP and TLS: requests, status codes, certificates and trust"
description: Read an HTTP exchange, triage 4xx and 5xx responses, and inspect a TLS handshake and certificate chain with curl and openssl.
type: guide
tags:
  - learning
  - networking
  - security
  - linux
created: 2026-10-17
modified: 2026-10-17
draft: false
---

> [!info] Level: junior-middle | Time: about 5 h | You need: [[learn/dns-resolution|Networking 03: DNS resolution]] | Lab: Option A, the Ubuntu LTS VM from [[learn/lab-setup|Start 01: Set up your lab]]

Most of what you operate speaks HTTP, and most of it is wrapped in TLS. When a user says "it returns an error", the first useful question is which error and from which hop. This lesson teaches you to read a request and a response, to tell a `502` from a `504`, and to look inside a certificate and a handshake instead of guessing.

Evidence level for this lesson: the `openssl x509`, `openssl s_client`, `curl --cacert` and `-checkend` behaviour in exercises 5, 7, 9 and 10 was spot-checked on a Linux machine with curl 8.5.0 and OpenSSL 3.0.13, against a local self-signed test server written in Python (not nginx). The nginx configuration, the redirect and SNI exercises, the public-internet outputs and everything else were not run, and are illustrative. The note carries no `verified` date for that reason.

## What you will learn

- The anatomy of an HTTP request and response, and the status codes you must recognise on sight.
- The difference between safe and idempotent methods, and between `301` and `308` redirects.
- The headers that matter in operations, and how HTTP/1.1, HTTP/2 and HTTP/3 differ in practice.
- How to read the timing of a request with `curl -w`.
- A method for triaging a `5xx`: who answered, the app, a proxy or a load balancer.
- What TLS gives you, how the 1.2 and 1.3 handshakes differ, what is inside an X.509 certificate, and how a chain is verified.
- How to diagnose common certificate failures and how to monitor expiry.

## HTTP in one page

HTTP is a request and response protocol on top of a reliable byte stream (TCP, or QUIC for HTTP/3). The client sends a request. The server sends one response. Each message is a start line, headers and an optional body. The semantics are defined in RFC 9110. HTTP/1.1 message syntax is in RFC 9112.

A request:

```text
GET /orders/42 HTTP/1.1
Host: shop.example.com
User-Agent: curl/8.5.0
Accept: application/json
Authorization: Bearer REDACTED
```

A response:

```text
HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 58
Cache-Control: private, max-age=0
ETag: "a1b2c3"

{"id":42,"status":"shipped","items":[{"sku":"A-100","qty":1}]}
```

_Illustrative._ The request line holds the **method**, the **target** and the version. The response line holds the version, the **status code** and a reason phrase. After the blank line comes the body.

`Host` is required in HTTP/1.1. It lets one IP address and port serve many sites, which is the same problem that SNI solves for TLS later in this lesson.

### Methods: safe and idempotent

| Method    | Meaning                        | Safe (no change) | Idempotent (repeat = same effect) |
| --------- | ------------------------------ | ---------------- | --------------------------------- |
| `GET`     | Read a resource                | yes              | yes                               |
| `HEAD`    | Same as `GET` without the body | yes              | yes                               |
| `OPTIONS` | Ask what is allowed            | yes              | yes                               |
| `PUT`     | Replace a resource             | no               | yes                               |
| `DELETE`  | Remove a resource              | no               | yes                               |
| `POST`    | Process data, create a thing   | no               | no                                |
| `PATCH`   | Partial change                 | no               | not guaranteed                    |

Why it matters to you: **idempotent requests can be retried safely.** A proxy, a client library or a service mesh may retry a `GET` or `PUT` after a timeout. Retrying a `POST` can create two orders. This is the base of the retry rules in [[patterns/timeouts-retries-load-shedding]].

### Status codes

The first digit is the class.

| Class | Meaning       | Whose problem it usually is   |
| ----- | ------------- | ----------------------------- |
| 1xx   | Informational | Rarely visible                |
| 2xx   | Success       | None                          |
| 3xx   | Redirection   | Client follows, or config bug |
| 4xx   | Client error  | The request is wrong          |
| 5xx   | Server error  | The server side failed        |

The codes to recognise at once:

| Code | Name                  | What it tells you                                                                               |
| ---- | --------------------- | ----------------------------------------------------------------------------------------------- |
| 200  | OK                    | Success, with a body.                                                                           |
| 201  | Created               | A resource was created; usually has a `Location` header.                                        |
| 204  | No Content            | Success with no body (common for `DELETE`).                                                     |
| 301  | Moved Permanently     | Use the new URL from now on. Clients may change `POST` to `GET`.                                |
| 302  | Found                 | Temporary redirect. Clients may change `POST` to `GET`.                                         |
| 304  | Not Modified          | Your cached copy is still valid (reply to a conditional request with `If-None-Match`).          |
| 308  | Permanent Redirect    | Like 301, but the client must keep the method and body.                                         |
| 400  | Bad Request           | The server could not parse or accept the request.                                               |
| 401  | Unauthorized          | No valid credentials. (The name is misleading: it means unauthenticated.)                       |
| 403  | Forbidden             | Credentials were understood, but you are not allowed.                                           |
| 404  | Not Found             | No such resource. Also used to hide that a resource exists.                                     |
| 421  | Misdirected Request   | This server cannot answer for this host name (seen with HTTP/2 connection reuse and TLS names). |
| 429  | Too Many Requests     | Rate limited. Often has `Retry-After`.                                                          |
| 500  | Internal Server Error | The application failed on something it did not expect.                                          |
| 502  | Bad Gateway           | A proxy or gateway got an invalid response, or none, from the server behind it.                 |
| 503  | Service Unavailable   | Not ready or overloaded. Often a proxy with no healthy backends. May have `Retry-After`.        |
| 504  | Gateway Timeout       | A proxy waited too long for the server behind it.                                               |

### 301 versus 308

Both are permanent. The difference is the method. Historically browsers turned a redirected `POST` into a `GET` for `301` and `302`. `307` (temporary) and `308` (permanent) were added to say "repeat the same request, with the same method and body, at the new URL". If an API client posts to an old path and you redirect with `301`, the follow-up may arrive as a `GET` with no body, and the data is lost without an error. Use `308` (or `307`) for redirects of APIs. You will watch this happen in exercise 3.

### Headers that matter in operations

| Header                         | Direction | Purpose                                                                                 |
| ------------------------------ | --------- | --------------------------------------------------------------------------------------- |
| `Host`                         | request   | Which site on this server. Routes virtual hosts.                                        |
| `Content-Type`                 | both      | Format of the body, for example `application/json`.                                     |
| `Cache-Control`                | both      | Caching rules: `no-store`, `max-age=60`, `private`, `public`.                           |
| `ETag` / `If-None-Match`       | both      | A version tag for a resource and the conditional request that uses it (leads to `304`). |
| `Location`                     | response  | Where to go next (redirects, and `201 Created`).                                        |
| `Authorization`                | request   | Credentials. Never log it; never put it in a URL.                                       |
| `X-Forwarded-For`, `Forwarded` | request   | The client address as seen by proxies. `Forwarded` is the standard form (RFC 7239).     |
| `Retry-After`                  | response  | How long to wait before trying again (with `429`, `503`).                               |

Headers set by proxies (`X-Forwarded-For`) can be forged by clients, so only trust the part added by your own proxy. [[learn/load-balancers-firewalls-and-network-troubleshooting|Networking 05]] covers this.

### Keep-alive and HTTP versions

Opening a TCP connection (and a TLS session on top of it) costs round trips. **Keep-alive** reuses one connection for many requests. HTTP/1.1 does it by default.

| Version  | Transport             | What changed                                                                                                                               |
| -------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| HTTP/1.1 | TCP                   | One request at a time per connection. Browsers open several connections to go faster.                                                      |
| HTTP/2   | TCP + TLS in practice | Many requests share one connection (multiplexing); headers are compressed. A lost packet still stalls every stream on that TCP connection. |
| HTTP/3   | QUIC over UDP         | Multiplexing without that stall. Needs UDP 443 to be open.                                                                                 |

The versions are specified in RFC 9112, RFC 9113 and RFC 9114. The version is negotiated, so one URL can be served over different versions to different clients. Which one you got appears in `curl -v` output. HTTP/3 support in `curl` depends on how it was built (verify with `curl --version`).

## Reading time with curl

`curl -w` prints variables after the transfer. The timing variables are **cumulative**: each is measured from the start, not from the previous step. Each value is therefore larger than the one before it, and you subtract to get the cost of one stage.

```bash
curl -s -o /dev/null https://example.com/ -w '\
namelookup:    %{time_namelookup}\n\
connect:       %{time_connect}\n\
appconnect:    %{time_appconnect}\n\
pretransfer:   %{time_pretransfer}\n\
starttransfer: %{time_starttransfer}\n\
total:         %{time_total}\n\
http_code:     %{http_code}\n'
```

```text
namelookup:    0.012
connect:       0.034
appconnect:    0.071
pretransfer:   0.071
starttransfer: 0.118
total:         0.119
http_code:     200
```

_Illustrative: your numbers will differ._ Read the sample like this.

| Variable        | Value | The stage ends when...                 | Cost of this stage                     |
| --------------- | ----- | -------------------------------------- | -------------------------------------- |
| `namelookup`    | 0.012 | DNS has answered                       | 12 ms (DNS)                            |
| `connect`       | 0.034 | the TCP handshake is done              | 22 ms (TCP)                            |
| `appconnect`    | 0.071 | the TLS handshake is done              | 37 ms (TLS)                            |
| `starttransfer` | 0.118 | the first byte of the response arrives | 47 ms (server think time and one trip) |
| `total`         | 0.119 | the last byte arrives                  | 1 ms (body)                            |

A big `namelookup` points to DNS ([[learn/dns-resolution|Networking 03]]). A big gap between `namelookup` and `connect` is network distance or a filtered port. A big gap before `starttransfer` is the server or the proxy chain. With plain HTTP, `appconnect` is `0.000` because there is no TLS stage.

## 5xx triage: who answered?

A `5xx` is a statement from a specific hop, not from "the server". The first job is to find the hop. You often have a chain like this:

```text
client -> CDN or WAF -> load balancer -> ingress / proxy -> application
```

Method:

1. **Reproduce with `curl -sv`.** Note the status line, the `Server` and `Via` headers, any request ID header, and the time.
2. **Read the response body and headers for clues.** Proxies add their own error pages and headers. A generic nginx-style page, a cloud load balancer's page and your application's JSON error each tell you who spoke.
3. **Decide what the code means for that hop.** `502`: the proxy reached a backend but got garbage or a closed connection, or could not connect at all. `503`: no healthy backend, or the app said "unavailable". `504`: the proxy waited and gave up.
4. **Go one hop down.** Call the next hop directly (bypass the CDN, then the LB), and repeat. Read its logs for the same request ID or time.
5. **Change one thing at a time.**

| Code | Typical cause at a proxy                                                       | First check                                      |
| ---- | ------------------------------------------------------------------------------ | ------------------------------------------------ |
| 500  | The app threw an error                                                         | Application logs for that request                |
| 502  | Backend down, crashed mid-response, wrong port or protocol, resets connections | Can the proxy connect? Backend logs and restarts |
| 503  | No healthy backends, rate limits, deploy in progress                           | Health checks and backend count                  |
| 504  | Backend too slow, or a timeout lower than the work needs                       | Backend latency; proxy timeout values            |

The key difference between **502 and 504**: with `502` the upstream answered badly or refused, usually fast. With `504` the upstream did not answer in time. The first is "broken or unreachable". The second is "alive but slow, or silent". You will provoke both in [[learn/load-balancers-firewalls-and-network-troubleshooting|Networking 05]].

## TLS: what it gives you

TLS (Transport Layer Security) wraps a TCP connection and gives three things:

- **Confidentiality.** Others on the path cannot read the data.
- **Integrity.** Others cannot change it without detection.
- **Authentication of the server.** The client can check that it talks to the owner of the name it asked for. (The client can also be authenticated, called mutual TLS, which this lesson does not cover.)

The authentication part is why certificates exist. Encryption without knowing who is at the other end only protects against passive listeners.

### The handshake: 1.2 and 1.3

At the start, client and server agree on parameters, prove identity and derive shared keys.

TLS 1.2 (RFC 5246) needs two round trips before the application data can flow:

```text
Client                              Server
  | ClientHello ----------------------> |
  | <------ ServerHello, Certificate,   |
  |         ServerKeyExchange, Done     |   (round trip 1)
  | ClientKeyExchange, Finished ------> |
  | <------------------------ Finished  |   (round trip 2)
  | ===== application data ===========> |
```

TLS 1.3 (RFC 8446) needs one:

```text
Client                              Server
  | ClientHello + key share -----------> |
  | <------ ServerHello + key share,     |
  |         {Certificate, Finished}      |   (round trip 1; braces = encrypted)
  | {Finished} --------------------------> |
  | ===== application data ===========> |
```

In 1.3 the certificate is already encrypted on the wire, old weak options were removed, and a resumed connection can send data sooner (with a replay risk, so it is limited to safe requests).

### ECDHE and forward secrecy

In both versions, modern setups use **ECDHE** (ephemeral elliptic-curve Diffie-Hellman). Each side makes a temporary key pair for this connection only, and they combine the public halves to get a shared secret. The server's certificate key is used only to sign, to prove identity. So if the server's long-term private key is stolen later, old recorded traffic still cannot be decrypted. That property is **forward secrecy**. TLS 1.3 requires it. TLS 1.2 allows it, and you should choose ciphers that provide it.

### ALPN and SNI

Two extensions in the `ClientHello` matter all the time.

- **SNI (Server Name Indication, RFC 6066).** The client states the host name it wants. A server or load balancer that hosts many sites on one IP address uses it to pick the right certificate. Without SNI you get the default certificate, which is probably for another name.
- **ALPN (Application-Layer Protocol Negotiation, RFC 7301).** The client lists the protocols it speaks (`h2`, `http/1.1`) and the server picks one. That is how HTTP/2 is chosen without an extra round trip.

> [!note] SNI is visible
> In classic TLS the SNI is sent unencrypted, so a network observer can see the host name. Encrypted Client Hello is a newer mechanism to hide it. Its support varies, so check the current state if it matters to you (not verified here).

## Certificates and trust

A certificate is a signed statement: "this public key belongs to these names". The format is X.509 (RFC 5280). Fields to read:

| Field                              | What to look at                                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Subject                            | Who the certificate is for. Informational only for host names.                                        |
| **Subject Alternative Name (SAN)** | The list of names the certificate is valid for. **This is what clients match against the host name.** |
| Issuer                             | Who signed it.                                                                                        |
| Validity (`notBefore`, `notAfter`) | The time window in which it is valid.                                                                 |
| Key Usage / Extended Key Usage     | What the key may do. A server certificate needs `serverAuth`.                                         |
| Basic Constraints                  | Whether this certificate is a CA (may sign others). `CA:TRUE` for CAs, `CA:FALSE` for a leaf.         |

**Why SAN and not CN.** The old way to put a host name in the certificate was the subject's common name (CN). Modern clients match the host name against the SAN list and ignore the CN when a SAN is present. A certificate with the right CN and no SAN fails in current clients. Put every name in the SAN list, and make the first one match the CN for older tools.

### The chain

A certificate is trusted if you can build a path from it to a certificate that your system already trusts.

```text
root CA            (in the client's trust store; self-signed)
  └── intermediate CA   (signed by the root)
        └── leaf             (your server certificate; signed by the intermediate)
```

The client holds a **trust store** of root CA certificates (on Linux, typically under `/etc/ssl/certs`; browsers and some runtimes keep their own). The server sends its **leaf and the intermediates**, not the root. Roots do not need to be sent because the client already has them (or does not trust them anyway). Intermediates **must** be sent, because the client usually does not have them. A server that sends only the leaf is serving an incomplete chain.

Verification checks, in short: each signature in the path is valid; each certificate is within its validity period; the intermediates are allowed to be CAs; the leaf is valid for the name asked for (SAN) and for server authentication; and the path ends at a trusted root. Revocation checks (CRL, OCSP) exist but vary widely in practice.

### Why "works in the browser, fails in curl"

A browser can fetch a missing intermediate itself, using the Authority Information Access (AIA) URL inside the certificate, or may have it cached from visiting another site. `curl` and most server runtimes (Python, Java, Go) do not. So a missing intermediate looks fine in a browser and fails in scripts and other services with `unable to get local issuer certificate`. The fix is on the server: configure it to send the full chain. Testing only in a browser hides the fault.

### Failure modes and their symptoms

| Failure             | Typical message (curl)                                                | Cause and fix                                                           |
| ------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Expired certificate | `certificate has expired`                                             | Renew. See [[runbooks/tls-certificate-renewal]].                        |
| Name mismatch       | `no alternative certificate subject name matches target host name`    | The name is not in the SAN list, or SNI selected the wrong certificate. |
| Unknown issuer      | `self-signed certificate` or `unable to get local issuer certificate` | Private CA not in the trust store, or an incomplete chain.              |
| Incomplete chain    | `unable to get local issuer certificate`                              | Server must send the intermediate.                                      |
| Clock skew          | `certificate is not yet valid` or `has expired` on a valid cert       | The _client's_ clock is wrong. Fix time sync.                           |
| Protocol mismatch   | `no protocols available` / handshake failure                          | Client and server share no TLS version or cipher.                       |

`curl` exit codes help in scripts: `60` is a peer certificate problem, `35` is a failed TLS connect, `6` is a DNS failure, `7` is a failed connection and `28` is a timeout. `77` means a problem reading the CA certificate file.

### Certificate lifetimes and expiry monitoring

Certificate lifetimes are getting shorter, so manual renewal does not scale.

> [!warning] Check before relying on this
> Not verified here: the CA/Browser Forum reduced the maximum validity of publicly trusted TLS certificates, with a step-down that starts in 2026 and continues in later years. Read the current Baseline Requirements and your certificate authority's notices for the exact dates and limits before you plan renewal cycles. Short lifetimes make automated renewal (ACME or your cloud's managed certificates) the only sensible approach.

Whatever the lifetime, expiry is a preventable outage. Monitor days left on **every endpoint users reach**, not just on the certificate files you manage. A load balancer can serve a different certificate than the one you just renewed. Alert well before the deadline. The script in exercise 9 is a starting point; production monitoring belongs in your alerting system.

## Hands-on exercises

Run these in the lab VM. Public-internet outputs are illustrative. For exercises that need a server you control, you build one with nginx and self-signed certificates.

Set up first. Install the tools and create two test certificates for two host names:

```bash
sudo apt install -y nginx curl openssl
sudo install -d -m 755 /etc/ssl/lab
for n in a b; do
  sudo openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
    -keyout "/etc/ssl/lab/${n}.key" -out "/etc/ssl/lab/${n}.pem" -days 30 \
    -subj "/CN=${n}.lab.example.com" \
    -addext "subjectAltName=DNS:${n}.lab.example.com"
done
sudo chmod 600 /etc/ssl/lab/*.key
```

The certificates are self-signed, valid for 30 days, and only for the lab. Do not reuse them anywhere else.

Now two nginx files. The first serves redirects on a plain HTTP port. The second serves two names on one TLS port.

```nginx title="/etc/nginx/conf.d/lab-redirects.conf"
server {
    listen 127.0.0.1:8080;
    server_name localhost;

    location = /old   { return 301 /new; }
    location = /moved { return 308 /new; }
    location = /new   { default_type text/plain; return 200 "new page\n"; }

    # A deliberate redirect loop.
    location = /loop-a { return 302 /loop-b; }
    location = /loop-b { return 302 /loop-a; }
}
```

```nginx title="/etc/nginx/conf.d/lab-tls.conf"
server {
    listen 127.0.0.1:8443 ssl default_server;
    server_name a.lab.example.com;
    ssl_certificate     /etc/ssl/lab/a.pem;
    ssl_certificate_key /etc/ssl/lab/a.key;
    default_type text/plain;
    return 200 "site a\n";
}

server {
    listen 127.0.0.1:8443 ssl;
    server_name b.lab.example.com;
    ssl_certificate     /etc/ssl/lab/b.pem;
    ssl_certificate_key /etc/ssl/lab/b.key;
    default_type text/plain;
    return 200 "site b\n";
}
```

Both listen only on the loopback address, so nothing is exposed. Check and load them: `sudo nginx -t && sudo systemctl reload nginx`. Expect `syntax is ok` and `test is successful`.

1. **Look at response headers.** Run `curl -sI https://example.com/`.
   Expected: a status line such as `HTTP/2 200` (or `HTTP/1.1 200 OK`), then headers like `content-type`, `cache-control` and `etag` or `last-modified`. With HTTP/2 the header names print in lower case.
   If you see something else: a `curl: (6)` means DNS failed (see [[learn/dns-resolution|Networking 03]]). A `curl: (7)` or `(28)` means the connection failed or timed out; check outbound access from your lab.

2. **Read the timing line.** Run the `curl -w` command from the timing section against `https://example.com/`.
   Expected: seven lines where `namelookup <= connect <= appconnect <= pretransfer <= starttransfer <= total`, and `http_code: 200`. Subtract neighbours to get the cost of each stage.
   If you see something else: if `appconnect` is `0.000000`, the URL was plain `http://`, so there was no TLS stage. If `namelookup` is large only on the first run, your resolver was cold.

3. **Follow redirects and compare 301 with 308.** Using your own nginx (do not rely on `http://example.com` redirecting; it does not reliably do so):

   ```bash
   curl -sI http://127.0.0.1:8080/old
   curl -sL http://127.0.0.1:8080/old
   curl -sL -d 'a=b' -o /dev/null http://127.0.0.1:8080/old
   curl -sL -d 'a=b' -o /dev/null http://127.0.0.1:8080/moved
   sudo tail -n 4 /var/log/nginx/access.log
   ```

   Expected: the first command shows `HTTP/1.1 301 Moved Permanently` and `Location: http://127.0.0.1:8080/new`. The second prints `new page`. The log shows that the `POST /old` after `301` was followed by `GET /new`, and the `POST /moved` after `308` was followed by `POST /new`: the method was kept only by `308`.
   If you see something else: if the log file is empty or missing, your nginx may log elsewhere; check `access_log` in `/etc/nginx/nginx.conf`. If you get `Connection refused`, nginx is not running or the conf file is not loaded: run `sudo nginx -t`.

4. **Catch a redirect loop.** Run `curl -sIL --max-redirs 5 http://127.0.0.1:8080/loop-a | grep -E '^(HTTP|Location)'` and then `echo "exit: ${PIPESTATUS[0]}"`.
   Expected: alternating `HTTP/1.1 302` and `Location:` lines, and a final exit code of `47` ("too many redirects").
   If you see something else: if you get `200`, the loop location is missing from the config. In a real incident, the same pattern appears when an app redirects to HTTPS, but a proxy in front already terminated TLS and forwards plain HTTP, so the app never sees HTTPS.

5. **Read a certificate.** Run:

   ```bash
   echo | openssl s_client -connect 127.0.0.1:8443 -servername a.lab.example.com 2>/dev/null \
     | openssl x509 -noout -subject -issuer -dates
   ```

   Expected: `subject=CN = a.lab.example.com`, the same value for `issuer` (self-signed, so subject and issuer are equal), and `notBefore` and `notAfter` dates 30 days apart.
   If you see something else: if the output is empty, the connection failed; check `sudo ss -ltnp | grep 8443`. If the subject is a different name, you reached a different server.

6. **Count the certificates in the chain.** Run:

   ```bash
   echo | openssl s_client -connect example.com:443 -servername example.com -showcerts 2>/dev/null \
     | grep -c 'BEGIN CERTIFICATE'
   ```

   Expected (illustrative): a small number such as `2` or `3`: the leaf plus the intermediate certificates. A self-signed lab server gives `1`.
   If you see something else: `0` means the connection did not reach TLS. If the number is `1` for a public site, that site sends no intermediate, which would be a chain problem for non-browser clients.

7. **Read the SAN list.** Run:

   ```bash
   echo | openssl s_client -connect 127.0.0.1:8443 -servername b.lab.example.com 2>/dev/null \
     | openssl x509 -noout -ext subjectAltName
   ```

   Expected: `X509v3 Subject Alternative Name:` followed by `DNS:b.lab.example.com`.
   If you see something else: `No extensions in certificate` means the certificate has no SAN. Modern clients reject it for host name checks. Recreate it with the `-addext` option from the set-up step. `-ext` needs OpenSSL 1.1.1 or newer.

8. **Forget SNI and see the wrong certificate.** Connect twice with different SNI values:

   ```bash
   echo | openssl s_client -connect 127.0.0.1:8443 2>/dev/null | openssl x509 -noout -subject
   echo | openssl s_client -connect 127.0.0.1:8443 -servername b.lab.example.com 2>/dev/null | openssl x509 -noout -subject
   ```

   Expected: `subject=CN = a.lab.example.com` for the first (the default server's certificate), and `subject=CN = b.lab.example.com` for the second.
   If you see something else: if both show `a`, `-servername` is being ignored or the `b` server block is missing; check that `lab-tls.conf` has both blocks and was reloaded. This is the same fault as a client that does not send SNI to a shared load balancer.

9. **Trigger and read verification errors.** Use `curl --resolve` to map lab names to the loopback address without touching `/etc/hosts`:

   ```bash
   curl -sS --resolve a.lab.example.com:8443:127.0.0.1 https://a.lab.example.com:8443/; echo "exit: $?"
   curl -sS --cacert /etc/ssl/lab/a.pem --resolve a.lab.example.com:8443:127.0.0.1 https://a.lab.example.com:8443/; echo "exit: $?"
   curl -sS --cacert /etc/ssl/lab/a.pem --resolve c.lab.example.com:8443:127.0.0.1 https://c.lab.example.com:8443/; echo "exit: $?"
   : > /tmp/empty-ca.pem
   curl -sS --cacert /tmp/empty-ca.pem --resolve a.lab.example.com:8443:127.0.0.1 https://a.lab.example.com:8443/; echo "exit: $?"
   ```

   Expected: the first prints `curl: (60) SSL certificate problem: self-signed certificate` and `exit: 60`. The second prints `site a` and `exit: 0`. The third (a name the certificate does not cover) prints `curl: (60) ... no alternative certificate subject name matches target host name 'c.lab.example.com'` and `exit: 60`. The fourth, with an empty CA file, ended with `curl: (77) error setting certificate file` and `exit: 77` on curl 8.5.0 with OpenSSL 3.0.13. Other versions or TLS libraries may behave differently, for example with exit 60 (verify on yours).
   If you see something else: if the first command works, your system trust store somehow trusts the lab certificate. Run `curl -V` and check whether `CURL_CA_BUNDLE` or `SSL_CERT_FILE` is set.

10. **Warn when a certificate is close to expiry.** Save the script and run it against the lab server:

    ```bash
    cat > ~/cert-days-left.sh <<'SCRIPT'
    #!/usr/bin/env bash
    # Warn when the certificate served by HOST:PORT expires within WARN_DAYS.
    set -euo pipefail

    HOST="${1:?usage: cert-days-left.sh HOST [PORT]}"
    PORT="${2:-443}"
    WARN_DAYS="${WARN_DAYS:-14}"

    pem="$(echo | timeout 10 openssl s_client -connect "${HOST}:${PORT}" -servername "${HOST}" 2>/dev/null | openssl x509)"
    end="$(printf '%s\n' "${pem}" | openssl x509 -noout -enddate | cut -d= -f2)"
    end_epoch="$(date -d "${end}" +%s)"
    days_left=$(( (end_epoch - $(date +%s)) / 86400 ))

    if printf '%s\n' "${pem}" | openssl x509 -noout -checkend $(( WARN_DAYS * 86400 )) >/dev/null; then
      echo "OK: ${HOST}:${PORT} certificate has ${days_left} days left (expires ${end})"
    else
      echo "WARNING: ${HOST}:${PORT} certificate has ${days_left} days left (expires ${end})" >&2
      exit 1
    fi
    SCRIPT
    chmod +x ~/cert-days-left.sh
    ~/cert-days-left.sh 127.0.0.1 8443
    WARN_DAYS=60 ~/cert-days-left.sh 127.0.0.1 8443; echo "exit: $?"
    ```

    Expected: the first run prints `OK:` with about 29 or 30 days left. The second prints `WARNING:` to the error stream and `exit: 1`, because the lab certificate expires in under 60 days. The script uses GNU `date -d` (Linux).
    If you see something else: if the script ends with no output and a non-zero exit, `openssl` could not connect or parse the certificate; `set -e` stops it. Run the `s_client` line alone to see why. Against a real endpoint use `~/cert-days-left.sh example.com 443`.

Clean up when you finish: `sudo rm /etc/nginx/conf.d/lab-redirects.conf /etc/nginx/conf.d/lab-tls.conf`, `sudo rm -r /etc/ssl/lab`, `sudo systemctl reload nginx`, `rm -f /tmp/empty-ca.pem ~/cert-days-left.sh`. Keep nginx installed, you will reuse it in the next lesson.

## Common mistakes

- **Reading `401` and `403` as the same.** `401` means "I do not know who you are", so check credentials or the token. `403` means "I know, and you may not", so check permissions and policy. Mixing them wastes time on the wrong layer.
- **Retrying non-idempotent requests blindly.** A `POST` retried after a timeout may run twice. Make writes idempotent with an idempotency key, or do not auto-retry them.
- **Redirecting an API with `301`.** A client may switch to `GET` and drop the body. Use `308` or `307`.
- **Testing certificates only in a browser.** Browsers repair missing intermediates and hide chain faults. Test with `curl` and `openssl s_client` too.
- **Trusting the CN.** Put every name in the SAN list. Check with `-ext subjectAltName`.
- **Forgetting SNI in tests.** Without `-servername`, `openssl s_client` shows the default certificate and sends you down a false trail.
- **`curl -k` in scripts and pipelines.** It turns verification off, so a fault or an attacker becomes invisible. Fix the trust (`--cacert`) instead, and use `-k` only for a quick local look.
- **Monitoring the certificate file, not the endpoint.** The thing users see may be a load balancer with an older certificate. Check what the endpoint serves.
- **Blaming the server when the client clock is wrong.** A skewed clock makes valid certificates look expired or not yet valid. Check `date` and time sync on the client first.

## Check your understanding

1. A user sees `502` and another sees `504` for the same page. What does each tell you about the proxy's view of the backend?
2. Why do modern clients match the host name against the SAN list and not the CN?
3. A service works in the browser but `curl` fails with `unable to get local issuer certificate`. What is the most likely fault and where do you fix it?
4. Why does SNI matter on a shared load balancer?
5. A new server's certificate shows as "not yet valid" to one client, and fine on others. What do you check?
6. Why can a `POST` that was redirected with `301` lose its body?

> [!question]- Answers
>
> 1. `502`: the proxy reached the backend but got an invalid response or could not connect (down, wrong port, resets). `504`: the proxy waited for the backend and the time ran out (slow or silent). Check backend health and connectivity for `502`, backend latency and timeout settings for `504`.
> 2. The CN is a single free-form field that was never meant for host names. The SAN is a typed list of DNS names and IP addresses, which can carry many names and is the standard place for them. Clients ignore the CN when a SAN exists, and a certificate with only a CN fails.
> 3. The server is not sending the intermediate certificate, and the browser repaired it on its own (cache or AIA fetch). Fix it on the server by installing the full chain (leaf plus intermediates) in its certificate file or load balancer configuration.
> 4. Many names share one IP address and port, so the server cannot see the host name until the HTTP request, which is after the handshake. SNI sends the name in the first message, so the load balancer can choose the matching certificate. Without it, the client gets a default certificate that probably fails the name check.
> 5. The client's clock. If it is behind the certificate's `notBefore`, it considers the certificate not yet valid. Check `date` and time synchronisation on that client.
> 6. Clients are allowed to turn a redirected `POST` into a `GET` for `301` and `302`, which sends no body. `307` and `308` require the method and body to be repeated.

## Next steps

Next lesson: [[learn/load-balancers-firewalls-and-network-troubleshooting|Networking 05: Load balancers, proxies, NAT, firewalls and network troubleshooting]]. Previous lesson: [[learn/dns-resolution|Networking 03: DNS resolution]].

For going deeper as a senior engineer:

- [[runbooks/tls-certificate-renewal]] for renewing and replacing certificates safely.
- [[patterns/timeouts-retries-load-shedding]] for retry and timeout rules that build on idempotency.
- [[runbooks/network-troubleshooting-dns-mtu-tls-load-balancers]] for a symptom-first runbook on GKE and GCP.
- The whole path is mapped in [[learn/index|the learning path]].

## Sources

- RFC 9110, HTTP semantics; RFC 9111, HTTP caching; RFC 9112, HTTP/1.1; RFC 9113, HTTP/2; RFC 9114, HTTP/3 (https://www.rfc-editor.org/rfc/rfc9110 and the following numbers).
- RFC 8446, TLS 1.3; RFC 5246, TLS 1.2 (https://www.rfc-editor.org/rfc/rfc8446).
- RFC 5280, Internet X.509 public key infrastructure certificate profile (https://www.rfc-editor.org/rfc/rfc5280).
- RFC 6066, TLS extensions, which define Server Name Indication; RFC 7301, ALPN; RFC 7239, Forwarded HTTP extension (https://www.rfc-editor.org/rfc/rfc6066).
- curl documentation, `--write-out` variables, exit codes and `--resolve` (https://curl.se/docs/manpage.html). The exit codes and the empty CA file behaviour were checked on curl 8.5.0 only.
- OpenSSL documentation for `s_client` and `x509` (https://docs.openssl.org/). The `x509`, `s_client -servername` and `-checkend` commands were spot-checked on OpenSSL 3.0.13 against a local test server; other versions are not checked.
- nginx documentation, `return` and `ssl_certificate` (https://nginx.org/en/docs/). The nginx configuration in this lesson was not run.
- CA/Browser Forum Baseline Requirements (https://cabforum.org/working-groups/server/baseline-requirements/documents/). Check the current lifetime limits there.
