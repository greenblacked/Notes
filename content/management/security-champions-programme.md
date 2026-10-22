---
title: Running a security champions programme with product teams
description: Scale security triage through one trained champion per product team, with agreed time, a responsibilities menu, platform support, a charter and honest metrics.
type: guide
tags:
  - management
  - security
  - team-process
  - leadership
  - sonarqube
  - supply-chain
created: 2026-10-21
modified: 2026-10-21
draft: false
---

A small platform or security team cannot read every SonarQube finding, every dependency update and every secret-scanning alert across dozens of repositories. If it tries, the queue grows, findings age past their deadlines, and product teams learn that security is something that happens to them. A security champions programme puts one trained, supported person in each product team who triages first, knows when to escalate, and brings security thinking into design discussions. It works only when the champion has real time, real support and real recognition; without those it becomes an unpaid title that fades within a year.

> [!info] Scope and what is not verified
> This note is a management practice, not a standard. OWASP publishes champions material in three places (the Security Culture project, the Developer Guide playbook and the Security Champions Guide), and it moves between projects; check the links in Sources. Not checked: how your SonarQube version treats security hotspots (newer versions may change or replace them, see below), and whether the quality gate condition on reviewed hotspots still exists in your version. No effectiveness data for champions programmes was reviewed, so this note makes no claims about measured outcomes. Time allocations and triage targets are examples to agree locally.

## What a champion is and is not

A champion is a member of a product team who is the first point of contact for security in that team. OWASP's Security Culture project describes the same problem this solves: the security team cannot cover every development team, so one person per team becomes the link.

| A champion is                                                    | A champion is not                                             |
| ---------------------------------------------------------------- | ------------------------------------------------------------- |
| The first triager of findings in their team's repositories       | The person who fixes every finding                            |
| The person who knows when and how to escalate                    | A replacement for the security team's review of risky changes |
| A participant in threat models and design reviews for their team | The approver of risk acceptance (that stays with the owner)   |
| A channel for platform defaults and new guidance into the team   | A compliance auditor of their colleagues                      |
| A volunteer with time agreed with their engineering manager      | Someone doing security "on top of" a full delivery load       |

**Time.** OWASP's playbook says management should agree the time commitment; it does not prescribe a number. A typical starting point is a fixed slice of the week, for example half a day, written into the team's plan and the champion's objectives. Agree the number with the champion's engineering manager, and treat it like on-call: if the slice is constantly eaten by delivery, the programme is not real.

## Selection and rotation

- **Nominate, do not assign.** The OWASP playbook recommends nominated volunteers. Ask each team for one, and accept that some teams will not have a candidate yet. A reluctant champion does more harm than none, because the team assumes security is covered.
- **Interest over seniority.** The best champions are curious and respected in their team. They do not need to be the most senior engineer; often a mid-level engineer who wants to grow is the best fit.
- **One per team, plus a backup** for larger teams, so holidays and departures do not leave a gap. See [[bus-factor-and-knowledge-transfer]].
- **Rotate deliberately.** A term of a year, renewable, with a planned handover, prevents burnout and spreads knowledge. OWASP's champions guide lists anticipating personnel changes among its principles, because programmes commonly fade with turnover.
- **Manager agreement in writing.** The engineering manager signs off the time slice in the charter (template below).

## Responsibilities menu

Not every team needs everything. Agree a subset per team in the charter and review it twice a year.

| Responsibility                    | What the champion does                                                                                    | Where the detail lives                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| New-code static analysis findings | Triages new security issues (and hotspots, if your SonarQube version still has them) on merge requests    | [[sonarqube-quality-gates]], [[0016-sonarqube-new-code-gate-blocks-merge]] |
| Dependency updates                | Makes sure update merge requests are reviewed and merged within the policy, escalates breaking majors     | [[dependency-update-policy]]                                               |
| Secret-scanning alerts            | Confirms a finding is real, starts rotation, never "fixes" by deleting the commit only                    | [[secret-scanning-pre-commit-and-ci]], [[leaked-credential-rotation]]      |
| Vulnerability SLA follow-up       | Watches the team's open findings against the SLA matrix, raises exceptions early                          | [[vulnerability-management-slas]]                                          |
| Threat models                     | Joins threat-modelling sessions for the team's changes, owns the team's entries in the threat register    | [[platform-threat-modelling]]                                              |
| Design and RFC review             | Reads RFCs from their team for security impact, pulls in the security team where the trigger list says so | [[rfc-and-design-review-process]]                                          |
| Knowledge sharing                 | Brings one item a month from the champions channel to the team (a new default, a lesson from an incident) | This note, cadence below                                                   |

> [!warning] Hotspots depend on your SonarQube version
> Older SonarQube Server documentation describes security hotspots as a separate review workflow with their own statuses. Newer versions may change this: whether hotspot rules now raise vulnerabilities or security issues instead, and what happens to existing hotspots, is **not verified** here. Check whether your version still has hotspots, and how they are reviewed, before you write hotspot review into the charter, and do not copy a status list from an older note.

**Triage, not fixing.** The champion's job on a finding is to decide quickly: real or false positive, which severity in context, who fixes it, and by when. The fix is the team's work, planned like any other item. A champion who fixes everything becomes a bottleneck and a single point of failure.

**False positives.** Marking a finding as a false positive or as accepted is a risk decision. Agree in the charter which decisions the champion may record alone (for example a clear false positive with a one-line reason) and which need the security team or the service owner (accepted risk, anything with an expiry). The exceptions process is in [[vulnerability-management-slas]].

## Enablement curriculum

Build on the material that already exists rather than writing a course from scratch. A first quarter for a new champion could look like this (example; adapt the order to what the team's repositories actually trigger):

| Week | Topic                                                  | Material                                                                                              |
| ---- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| 1    | Basics of secrets, least privilege and supply chain    | [[security-basics-for-devops]]                                                                        |
| 2    | Reading and triaging static analysis on new code       | [[sonarqube-basics-first-scan-and-triage]], [[sonarqube-quality-gates]]                               |
| 3    | Secret scanning and what to do when a secret leaks     | [[secret-scanning-pre-commit-and-ci]], [[leaked-credential-rotation]]                                 |
| 4    | Dependency updates and the update policy               | [[dependency-update-policy]]                                                                          |
| 5-6  | Vulnerability SLAs, exceptions and reporting           | [[vulnerability-management-slas]]                                                                     |
| 7-8  | Threat modelling: join one real session, then lead one | [[platform-threat-modelling]]                                                                         |
| 9+   | External references for depth                          | OWASP Cheat Sheet Series, OWASP Top Ten, OWASP ASVS (the playbook suggests these as a knowledge base) |

Pair each new champion with an experienced one or with a security engineer for the first quarter. OWASP SAMM's Education and Guidance practice (Training and Awareness, Organization and Culture streams) is a useful frame if you need to describe the programme's maturity to leadership; check the model pages for the current wording.

## What the platform and security teams provide

A champion with no backing gives up. The central teams owe the champions:

- **Secure defaults on the paved road.** Every check a champion would otherwise chase by hand should be on by default in the shared CI templates: the quality gate, secret scanning, dependency updates, image scanning. Champions triage results; they should not have to set up the tooling. See [[inner-source-platform]] for how teams contribute improvements back.
- **Office hours.** A fixed weekly slot where champions bring findings they are unsure about. This is cheaper than ad-hoc messages and builds the community.
- **An escalation path** with a response time the security team actually meets. Write it in the charter. If escalations sit unanswered, champions stop escalating.
- **A shared channel and a knowledge base.** One place for questions, decisions on recurring false positives, and short write-ups of what was learned. OWASP's playbook lists communication channels and a knowledge base as two of its six steps.
- **Recognition that counts.** Champion work appears in the champion's objectives, in their performance review and in promotion cases. Map it to the security and influence expectations of the [[career-ladder-devops]], and ask the security team to give written input to [[performance-feedback]]. Thanks in a channel is nice; a line in a promotion case is what keeps people in the role.
- **A named programme lead** (the OWASP Security Champions Guide principles appear to call this a captain; not verified here, check the guide) who runs the cadence and is accountable for the programme's health.

## Metrics that help, and one that does not

Measure whether findings are handled, not how many exist.

| Metric                        | How to measure                                                                                     | Why it helps                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Time to triage                | From a finding being raised to the first triage decision, per team, median and p85                 | Shows whether champions have time and know what to do    |
| SLA adherence                 | Share of findings fixed or excepted within the SLA matrix                                          | The outcome the programme exists for                     |
| Ageing findings               | Open findings older than their SLA, per team                                                       | Points to teams that need help, not blame                |
| Gate coverage                 | Share of active repositories with the quality gate, secret scanning and dependency updates enabled | Measures the paved road, which is the central team's job |
| Champion coverage and tenure  | Teams with an active champion; average time in role                                                | Early warning of fading interest                         |
| Threat models with a champion | Share of threat-modelling sessions for a team's changes that included its champion                 | Shows design-time involvement                            |

**Findings counts are not a metric.** The number of findings depends on the rule set, the scan scope, the languages and how much new code was written. A team that turns on a stricter profile or onboards ten legacy repositories gets more findings while getting safer. Report counts as context if you must, never as a target and never compared across teams.

Set the targets locally. A first target such as "median time to triage within two working days" (example, set your own) is a reasonable place to start; tighten it once the data shows what is achievable.

## Charter template

Keep one charter per team in the programme's repository so changes are reviewed.

```markdown title="security-champions/charter-<team>.md"
# Security champion charter: <team>

**Champion:** <name> **Backup:** <name>
**Engineering manager:** <name> **Programme lead:** <name>
**Term:** <start date> to <end date> (renewable)
**Agreed time:** <for example half a day per week>, recorded in the team plan

## Responsibilities for this team

- [ ] Triage new-code static analysis security findings on merge requests
- [ ] Follow dependency update merge requests against the update policy
- [ ] First response to secret-scanning alerts, then rotation runbook
- [ ] Watch open findings against the vulnerability SLA matrix
- [ ] Join threat-modelling sessions for the team's changes
- [ ] Read the team's RFCs for security impact

## Decisions the champion may record alone

- False positive with a one-line reason: yes / no
- Severity change in context: yes, with reason / no
- Accepted risk or exception: no (service owner and security, with an expiry)

## Escalation

- Channel: <channel>; office hours: <day and time>
- Security team first response: within <agreed time>
- Urgent (suspected incident): follow the incident process, page the on-call

## Review

- Charter reviewed: every six months, or when the team or champion changes
- Metrics reviewed: monthly, in the champions sync
```

## Cadence

| When             | What                                                                       | Who                                |
| ---------------- | -------------------------------------------------------------------------- | ---------------------------------- |
| Weekly           | Office hours                                                               | Security engineer, any champion    |
| Every two weeks  | Champion triages the team's open findings and dependency updates           | Champion                           |
| Monthly          | Champions sync: metrics by team, one short talk, recurring false positives | Programme lead, all champions      |
| Quarterly        | Programme review with engineering managers: coverage, SLA adherence, asks  | Programme lead, EMs, security lead |
| Every six months | Charter review per team, rotation decisions                                | Champion, EM, programme lead       |
| Yearly           | Programme retrospective; refresh the curriculum                            | Programme lead                     |

Put the quarterly numbers in the [[quarterly-engineering-review]] next to the vulnerability metrics.

## Failure modes

- **The title without the time.** The champion is named but the team plan has no slot for the work. Findings age, the champion feels guilty, then leaves the role. Fix: the time slice is in the charter and the plan, and the EM is accountable for it.
- **The champion as the security team's inbox.** Every finding is forwarded to the champion, who becomes the person who fixes things. Fix: triage only; fixes go to the team's backlog.
- **Fading after the launch.** Strong start, then attendance drops as people move teams. The OWASP Developer Guide notes this pattern. Fix: a named lead, rotation with handover, recognition in reviews, and a quarterly look at coverage.
- **Unanswered escalations.** Champions escalate, the security team is slow, champions stop escalating. Fix: a published response time that is met, and reported.
- **Tooling chores.** Champions spend their slice configuring scanners. Fix: the paved road ships the defaults.
- **Policing colleagues.** The champion is used to report on their team. Fix: metrics are per team, discussed with the team, never used for individual blame.

## Common mistakes

- **Launching with a big event and no cadence.** Interest peaks at the kickoff and drops. Start with office hours and the monthly sync, then add events.
- **Measuring finding counts.** They reward turning scanners off. Measure triage time and SLA adherence.
- **Copying another company's programme wholesale.** OWASP's material is a frame. Fit the responsibilities to the scanners and processes you actually run.
- **Making every engineer a champion.** Then nobody is. One per team, with a backup.
- **No exit path.** Champions who cannot leave the role burn out. Terms and rotation are part of the design.

## Sources

- [OWASP Security Culture, Security Champions](https://owasp.org/www-project-security-culture/stable/4-Security_Champions/): the single point of contact per team, typical activities.
- [OWASP Developer Guide, Security Champions Playbook](https://devguide.owasp.org/en/08-culture-process/02-security-champions/03-security-champions-playbook/): six steps, nominated champions, management-agreed time, knowledge base suggestions.
- [OWASP Developer Guide, Security champions programme](https://devguide.owasp.org/en/08-culture-process/02-security-champions/01-security-champions-program/): programmes that fade with turnover or budget pressure.
- [OWASP Security Champions Guide](https://securitychampions.owasp.org/): its principles for running a programme (the principle names were not verified here; read the current list on the site).
- [OWASP SAMM, Education and Guidance](https://owaspsamm.org/model/governance/education-and-guidance/): the governance practice and its two streams.
- [SonarQube Server, security hotspots](https://docs.sonarsource.com/sonarqube-server/user-guide/security-hotspots): the current status of hotspots; check the page for your version.

## Related

- [[sonarqube-quality-gates]]: the gate champions triage against.
- [[secret-scanning-pre-commit-and-ci]]: secret findings and the response.
- [[vulnerability-management-slas]]: the deadlines champions follow.
- [[platform-threat-modelling]]: the design-time process champions join.
- [[security-basics-for-devops]]: the first lesson for a new champion.
- [[career-ladder-devops]]: recognising champion work.
- [[rfc-and-design-review-process]]: where champions review design changes.
- [[sonarqube-vs-semgrep-vs-codeql]]: background on static analysis tools.
