---
title: Running one-on-ones with platform engineers
description: Cadence, agenda template, questions that surface burnout and career goals, note-taking and skip-levels for 1:1s on a DevOps or platform team.
type: guide
tags:
  - management
  - leadership
  - team-process
  - on-call
created: 2026-10-16
modified: 2026-10-16
draft: false
---

A one-on-one is the engineer's meeting, not yours. On a platform team it is also the only reliable place where you hear that on-call is wearing someone down, that a migration is stuck on a dependency, or that a person wants to move toward architecture. Status you can get from GitLab and the incident channel; the 1:1 is for what those do not show.

## Cadence and format

- **Weekly, 30 minutes** for engineers who are new, in a hard stretch (a heavy on-call rotation, a visible migration) or on an improvement plan (see [[performance-feedback]]).
- **Fortnightly, 45 minutes** for stable seniors. Do not go below fortnightly; a monthly 1:1 turns into a review.
- Keep the slot fixed and move it rarely. Cancelling signals priority. If you must move it, move it the same day with a new time.
- Put it away from the on-call handover and from release windows. An engineer who is carrying the pager will be distracted.
- Remote: use video, camera on by default for the first few meetings, and a shared document both of you edit. Walking calls work well for people who dislike staring at a screen.

> [!tip] Hold the meeting even when nothing is wrong
> A quiet 1:1 is useful data. The first time something is wrong, the habit already exists.

## Agenda template

Keep one shared document per engineer, newest entry on top. The engineer owns the top section; you add yours below.

```markdown title="1on1-<name>.md"
## 2026-10-16

### Engineer's topics

- (their items first, always)

### Standing questions

- How is the workload? Anything you are dropping or worried about?
- On-call since last time: pages, sleep, anything that felt unfair?
- What is blocking you that I could remove?

### My topics

- Feedback (one specific item, using SBI)
- Context they may not have: roadmap, priorities, org changes

### Career / growth (every second or third meeting)

- Where do you want to be in 12 months?
- Next stretch task toward that

### Actions

- [ ] Me:
- [ ] Them:
```

Spend roughly 60% of the time on their topics, 20% on yours and 20% on growth. Review last meeting's actions first; unfulfilled actions on your side are the quickest way to lose trust.

## Questions that surface problems early

People rarely say "I am burning out". They answer specific questions honestly if the question is concrete and safe.

**On-call fatigue and burnout**

- "Think about your last on-call week. Which night was worst, and what would have made it less bad?"
- "How many pages in the last rotation did you consider not actionable?"
- "When did you last fully switch off for a weekend?"
- "If you could delete one alert, which would it be?"
- "Do you dread the handover, or look forward to it?"

Watch for changes rather than absolute answers: shorter replies, camera off, skipped reviews, commit times moving later. Correlate with the data in [[on-call-health]]; if a person has been paged outside hours more than their peers, address the rotation, not the person.

**Workload and toil**

- "What did you do last week that a script should do?"
- "What are you the only person able to do? Does that worry you?"

**Career goals**

- "What kind of work gave you energy this quarter, and what drained you?"
- "Which role on this team, or elsewhere, looks interesting to you?"
- "What would you want in your next performance review that is not there today?"

Map the answers to the expectations in [[career-ladder-devops]] and pick one concrete stretch item, for example leading a post-incident review under [[blameless-postmortems]] or owning a service (see [[delegation-and-ownership]]).

**Relationship with you**

- "What is one thing I could do differently that would help you?"
- "Is the feedback I give you useful? Too much, too little?"

Say thank you, do not defend, and act visibly on at least one answer within a fortnight.

## Anti-patterns

- **The status-update 1:1.** If the engineer lists tickets and you nod, you have a stand-up with fewer people. Ask "what is the part of this you are unsure about?" and redirect status to the board.
- **Manager-driven agenda.** You talk for most of the time and use the slot for your own backlog.
- **Only problems.** Skipping recognition makes the meeting feel like a trial. Say what went well, specifically.
- **Fire-fighting overrun.** If an incident eats the slot, reschedule within 48 hours, not "next time".
- **Taking notes on a laptop and typing through the conversation.** Look at the person; write after.
- **Treating the 1:1 as a performance evidence meeting.** Collect evidence separately, then discuss it openly.

## Note-taking

- Write down commitments and facts, not impressions: "wants to lead the GKE upgrade next quarter", "third night page in a row for the same alert".
- Keep notes in a private document. Tell the engineer what you record and that they can read it; transparency prevents surprises at review time.
- Do not store health, family or personal circumstances beyond what the person asked you to remember. Follow your company's HR guidance on sensitive information.
- Before reviews, skim the last six months of notes for patterns. They are the raw material for [[performance-feedback]] and promotion cases.

## Skip-levels

If you have managers or a lead reporting to you, hold a skip-level 1:1 with their reports roughly quarterly, 30 minutes, with one clear purpose: to learn how the team is doing and how your own organisation looks from below.

- Tell the intermediate manager first and why; it is not an audit.
- Ask open questions: "What would you change about how we work?", "What is slowing the team down most?"
- Do not take over decisions in the skip-level. Feed themes back to the manager, without attribution if the person asked for confidentiality.
- Report what you will do about it afterwards, even when the answer is "nothing, and here is why".

## Remote specifics

- Time zones: rotate inconvenient slots instead of fixing them on the same person.
- Ask about the working environment: noise, network, desk, and whether they have time without meetings.
- Use async notes between meetings. A line in the shared document on Wednesday beats waiting for Friday.
- Schedule an occasional unstructured, non-work call. Remote engineers lose the incidental conversations an office provides.
- Handle on-call handovers explicitly: ask how the handover went and whether the previous person left usable context in the runbooks.

## Related

- [[first-90-days-as-em]] for how to start these meetings with a new team.
- [[onboarding-engineers]] for the extra frequency and agenda a new hire needs.
- [[managing-conflict]] when a 1:1 reveals tension between team members.
