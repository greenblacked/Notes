---
title: Isolation boundaries for browser agents
description: Separate browser-agent sessions, identities, profiles, and network reach so web content cannot inherit a human operator’s broad access.
type: guide
tags:
  - ai
  - security
created: 2026-10-26
modified: 2026-10-26
draft: false
---

Browser agents combine a model with a session that may hold cookies, credentials, internal app access, and form-submission authority. They interpret untrusted pages and can act on them. The boundary includes model, browser, profile, network, identity provider, and target site. This guide focuses on browser isolation; tool permissions are in [[ai/agent-tool-authorization-boundaries]].

The host and runner isolation baseline in [[ai/sandboxing-coding-agents-on-workstations-and-runners]] is relevant, but browser sessions need additional identity and profile controls.

The owner’s [AI skills catalogue](https://ai.szolotov.com) provides reusable skills and workflows.

## Use a dedicated identity and profile

Run automation in a dedicated browser profile or managed browser session with no personal cookies, saved passwords, extensions, password-manager access, or unrelated browsing history. Do not attach an employee’s everyday profile or reuse a logged-in administrative session. Use a narrowly scoped automation identity with access only to the application and data needed for the workflow. Separate accounts or tenants for testing and production, and make production access exceptional, time-bound, and approval-gated.

Authentication should be established through a managed identity flow rather than by giving the model secrets to type into a page. Protect session cookies and browser debugging interfaces as credentials. Prevent other local processes and sessions from reading the profile directory, and destroy ephemeral profiles when the task ends, subject to evidence retention requirements. A browser session can remain authenticated after the UI closes; verify the platform’s logout and session expiry behavior instead of treating process termination as revocation.

## Isolate the browser and its network

Run the browser in a separate, low-privilege process or sandbox with a dedicated user, filesystem, and network policy. Do not mount host home directories, SSH agents, cloud credentials, local sockets, or sensitive shared folders into the browser environment. Disable unnecessary downloads, clipboard access, file chooser access, device access, and extension APIs. If the workflow needs to upload or download a file, route it through a controlled staging area that scans and labels the object.

Constrain reachable destinations using the egress controls in [[ai/agent-network-egress-controls]]. A browser can be induced to navigate, submit forms, or load resources, so network policy should not trust the page or the model’s intent. Block internal management networks and metadata services unless the use case has a reviewed need. Handle redirects and link previews carefully, and avoid sending privileged cookies to a destination outside the approved origin set.

## Treat page content as untrusted

Web pages, documents, advertisements, comments, and application-generated content are data, not policy. A page may contain visible or hidden text that attempts to influence the agent. Browser automation should not let page content expand the approved task, destination set, or authority. Keep a narrow task plan and validate each action against an application-defined list of allowed origins, actions, and target objects. Page labels and model summaries are not proof that an action is safe.

Do not rely solely on visual confirmation from the model. For a sensitive action, show the user a trusted summary of the destination, account, object, and effect using application state where possible, then require explicit confirmation. An approval should apply to one exact operation and expire. Never accept a page instruction to reveal credentials, navigate to an unapproved site, or bypass a control as authorization. The user’s initial task is also not a blanket grant for any action a page requests.

## Bound side effects and browser APIs

Start with read-only browsing. When a workflow needs a write, use a separate capability or session with the narrowest available permissions. Disable payment, administrative, account-recovery, and destructive operations unless explicitly required. Avoid arbitrary JavaScript execution, developer tools, remote debugging endpoints, and unrestricted downloads when the business task does not need them. Browser automation APIs vary; verify the actual product’s permission model and which process can access browser state.

Record action decisions, URL origin, browser/session identifier, authentication principal, policy result, approval, and outcome. Avoid storing full page content or screenshots by default, because they can contain personal or confidential data. If screenshots are necessary for audit, define access and retention. A browser trace is sensitive evidence, not a routine debug artifact.

## Test isolation and failure behavior

Use a staging environment and harmless pages to verify that a page cannot cause an unapproved navigation, form submission, file download, or tool call. Test profile separation, session expiration, blocked destinations, unexpected redirects, popup windows, downloads, frame navigation, and browser crashes. Confirm that the agent fails safely when the identity provider, policy service, or browser automation channel is unavailable. Do not test against third-party accounts or production users without authorization.

Common failures include running the automation with a human’s full browser profile, granting broad SSO groups, leaving a remote debugging port reachable, and assuming a container alone hides browser credentials. Another failure is a user approval flow that confirms only the natural-language task while the target or fields can change afterward. Bind the approval to the exact action and re-evaluate permission at submission time.

## Review checklist

- Is the browser session dedicated, disposable, and free of unrelated credentials?
- Is the identity restricted to the specific app and task?
- Are host files, sockets, extensions, clipboard, downloads, and debug interfaces limited?
- Can the browser reach only reviewed network destinations?
- Is untrusted page content prevented from expanding policy or authority?
- Are writes separately enabled and confirmed against the exact target and effect?
- Are session expiry and logout behavior verified for this provider?
- Are screenshots and traces minimized, access-controlled, and time-limited?

## Sources

- [NIST SP 800-207, Zero Trust Architecture](https://csrc.nist.gov/pubs/sp/800/207/final): identity- and resource-focused access principles.
- [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/): agent identity, tool, and execution risks.
- [Anthropic: Mitigate jailbreaks and prompt injections](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/mitigate-jailbreaks): provider guidance for untrusted external content; model-specific details can change.
- [NIST AI 600-1, Generative AI Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf): AI risk management context.
