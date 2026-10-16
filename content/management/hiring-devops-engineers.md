---
title: Hiring DevOps and SRE engineers
description: A structured hiring loop for DevOps and SRE roles, with a troubleshooting exercise, question bank, scoring rubric and debrief process.
type: guide
tags:
  - management
  - hiring
  - leadership
  - team-process
created: 2026-10-16
modified: 2026-10-16
draft: false
---

Hiring for infrastructure roles fails in two ways: testing trivia (flags and syntax that a search engine answers) or testing nothing (a pleasant chat). A good loop measures how someone reasons about a broken system, how they communicate under uncertainty, and whether they will operate safely on production. Decide the criteria before you meet a single candidate.

## Define the role first

Write down, before the job description:

- the three or four problems this person will own in the first year (for example "reduce pipeline time", "take over GKE upgrades", "cut pager noise");
- the level, using [[career-ladder-devops]];
- which skills are required on day one and which can be learned in the first quarter;
- the on-call expectation and how the rotation is structured (see [[on-call-health]]).

## Job description

Keep it short and specific. Candidates self-select on what you write.

- Open with the team, the platform and the problem, not a list of buzzwords.
- Separate "you will" from "you have". Limit requirements to what the role actually uses; long lists of tools reduce applications from people who would succeed, disproportionately from underrepresented groups.
- State the stack honestly (GKE, Terraform, GitLab CI, Helm, Artifactory) and what is legacy.
- State on-call, hybrid or remote expectations, salary range where the law or your policy allows, and the interview process, including the exercise and how long it takes.

## Stages

| Stage                       | Length           | Who                              | Purpose                                                     |
| --------------------------- | ---------------- | -------------------------------- | ----------------------------------------------------------- |
| CV screen                   | 10 minutes       | Recruiter or EM                  | Against written must-haves only                             |
| Intro call                  | 30 minutes       | EM                               | Motivation, expectations, answer their questions            |
| Technical exercise          | 60 to 90 minutes | Two engineers                    | Troubleshooting and design in a shared terminal or document |
| Systems design / experience | 60 minutes       | Senior engineer                  | Depth on past work, operational judgement                   |
| Collaboration and values    | 45 minutes       | EM plus a peer from another team | Communication, incident behaviour, feedback                 |
| Debrief                     | 30 minutes       | All interviewers                 | Decision                                                    |

Keep it to a total of about four to five hours of candidate time and a response within two working days of each stage. Use the same stages and questions for every candidate for the role.

## Practical exercise

Prefer a live troubleshooting session to a take-home project. It takes less of the candidate's time, shows how they think and cannot be outsourced.

**Rules**

- Send the format in advance. No surprises about what kind of exercise it is.
- Let them use documentation and a search engine; that is how the job works.
- Interviewers say little. Answer factual questions about the environment ("what do the logs show") and nothing more.
- Score the approach, not whether they reach the root cause in time.

**Sample scenario**

> The checkout service is returning intermittent 503 errors after a deployment 40 minutes ago. The application runs on GKE behind an ingress. You have `kubectl` access and a dashboard. Error rate is 8%. Start by telling us what you will check first and why.

Prepared facts (reveal as they ask):

1. The new deployment rolled out; the previous ReplicaSet scaled down.
2. Pods show `Ready 1/1`, but the readiness probe path points to a health endpoint that returns 200 before the database connection is established.
3. Memory usage on two pods is close to the limit and one has restarted with `OOMKilled`.
4. A config change in the same release reduced the connection pool size.
5. Rolling back resolves the issue; the root cause was the pool size combined with a readiness probe that does not check dependencies.

What to watch for: stabilise first (rollback or scale) versus dig first; checking recent changes; moving from symptoms to hypotheses; using `kubectl describe`, events and logs sensibly; communicating status to a stakeholder; what they would change afterwards (probes, alerts, a postmortem under [[blameless-postmortems]]). Compare their behaviour with [[incident-response]] and [[kubernetes-pod-troubleshooting]].

A second, shorter design prompt: "Design the deployment pipeline for a team of ten services moving from Jenkins to GitLab CI. What do you migrate first and how do you make rollback easy?" Look for incremental migration, risk awareness and trade-offs.

## Structured interview questions

Ask the same questions of each candidate and take notes on the answers, not on impressions. Use a follow-up of "what did you personally do?" to separate ownership from participation.

| Question                                                                           | What good looks like                                                                                       |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Tell me about the last production incident you handled. What was your role?        | Clear timeline, calm prioritisation, mitigation before cause, a concrete follow-up that changed something. |
| Describe a time you changed a system and it broke something.                       | Owns the mistake, explains detection, fix and prevention, no blame.                                        |
| How do you decide what to automate?                                                | Considers frequency, risk and cost; has examples of automation that was _not_ worth building.              |
| How would you roll out a Terraform change that affects shared networking?          | Plan review, small blast radius, state backups, staged apply, rollback plan; mentions locking and drift.   |
| A developer asks for admin access to the cluster "just for today". What do you do? | Asks what they need, offers the least privilege path, records the decision, does not just say no.          |
| Describe how you handled an alert that kept firing without being useful.           | Evidence-based tuning or deletion, ties to SLOs ([[slo-burn-rate-alerting]]).                              |
| How do you give a colleague critical feedback on a risky change?                   | Specific, kind, timely, checks understanding; avoids personal language.                                    |
| What would you want to learn in your first 90 days?                                | Asks about systems, on-call and people; not only about tools.                                              |

Adjust depth by level. A staff candidate should also describe influencing other teams and killing projects; a mid-level candidate needs strong fundamentals and good learning habits.

## Scoring rubric

Each interviewer scores independently before the debrief, on a 1 to 4 scale with evidence for every score.

| Score | Meaning                                                                               |
| ----- | ------------------------------------------------------------------------------------- |
| 1     | Clear concern: could not show the skill, or showed behaviour that would harm the team |
| 2     | Below the bar for this level; significant gaps                                        |
| 3     | Meets the bar; would be effective in the role                                         |
| 4     | Exceeds the bar; raises the team's level                                              |

| Competency            | 1                                | 3                                                   | 4                                              |
| --------------------- | -------------------------------- | --------------------------------------------------- | ---------------------------------------------- |
| Troubleshooting       | Random guesses, no stabilisation | Structured hypotheses, checks changes, communicates | Fast isolation, trade-off thinking, prevention |
| Infrastructure design | Tool lists without reasoning     | Sound design with risks named                       | Considers cost, failure modes, migration path  |
| Operational judgement | Ignores blast radius             | Uses staged change, rollback, monitoring            | Designs for safe change by default             |
| Communication         | Vague or defensive               | Clear, concise, audience aware                      | Teaches while explaining, writes well          |
| Collaboration         | Blames others                    | Constructive, receives feedback                     | Raises the team's practice                     |
| Growth mindset        | Static                           | Learns from failure                                 | Actively seeks feedback and teaches            |

## Reducing bias

- Fixed questions, fixed scoring, same order. Structured interviews predict performance better than unstructured chats, and they are easier to defend.
- Score before the debrief and submit in writing. The first person to speak should not anchor the others.
- Avoid "culture fit"; use "values add" and write down which value was shown.
- Anonymise CVs if you can, or at least ignore school names and company brands that do not map to the must-haves.
- Diverse panels, including at least one person outside the immediate team.
- Check your own proxies: confidence, accent, similarity to you. Ask "what evidence do I have?"
- Offer reasonable adjustments, such as extra time or a written format, to any candidate who requests them.

## Debrief and decision

1. Each interviewer shares their score and two sentences of evidence, lowest first.
2. Discuss disagreements by evidence, not seniority.
3. The hiring manager decides, using the rubric: a candidate below 3 on a must-have competency does not proceed unless the role's priorities say otherwise, and that exception is written down.
4. Record the decision and reasoning in the hiring system.
5. Give feedback to every candidate who reached the exercise, in a few specific sentences.
6. Call, don't email, the offer. Share the 30/60/90 outline from [[onboarding-engineers]] so they know what the first three months look like.

Review the loop every six months: which signals predicted who succeeded? Remove questions that do not discriminate.
