# SurveyBeat

SurveyBeat measures how a team is doing over time through short recurring check-ins, and helps the team act on what it learns.

## Tenancy and people

**Organization**:
The tenant. Every other record belongs to exactly one Organization, and data never crosses Organizations.
_Avoid_: Tenant, company, account, workspace

**Person**:
A human in an Organization, who may exist before ever signing in (imported or invited).
_Avoid_: User, employee, respondent

**Organization admin**:
A Person who administers an Organization: its Teams, Leads, and People. Being an admin gives no access to any Team's Results.
_Avoid_: Owner, superuser, account admin

**Team**:
A named group of People, optionally nested inside another Team.
_Avoid_: Group, squad, department (a department is just a parent Team)

**Membership**:
A Person's role (lead, member, or viewer) in one Team over a date range.
_Avoid_: Seat, assignment

**Lead**:
A Person holding the lead role in a Team's Membership.
_Avoid_: Manager, owner, admin

## Asking

**Question**:
A reusable item in the Organization's question library, with a type and text.
_Avoid_: Item, field, prompt

**Question version**:
One meaning of a Question. Answers always point at a Question version, never at the Question itself.
_Avoid_: Revision, edit

**Dimension**:
A theme a Question measures, such as workload or psychological safety, used to group scores.
_Avoid_: Category, topic, factor

**Template**:
A ready-made starting set of Questions, grouped by Dimension, that a Lead copies to create a Pulse. The Pulse does not change when its Template changes.
_Avoid_: Preset, blueprint

**Pulse**:
A recurring check-in for one Team: an ordered set of Question versions, a cadence, an answer window, an anonymity mode, and a distribution (invitation or link).
_Avoid_: Survey, questionnaire, form

**One-off survey**:
A Pulse with no cadence and exactly one Round. Not a separate concept.
_Avoid_: Survey (when meaning the concept)

**Distribution**:
How a Pulse reaches people: by Invitation (one per eligible member, so response rates are known) or by shared link (no Invitations, no response rate, no one-answer-per-person guarantee). Fixed per Pulse.
_Avoid_: Channel (that means email, Slack, or Teams)

**Channel**:
The medium an Invitation travels through: email, Slack, or Microsoft Teams.
_Avoid_: Distribution, transport

**Round**:
One occurrence of a Pulse, with its Question versions and eligible members frozen when it opens.
_Avoid_: Instance, iteration, run, wave

**Anonymity mode**:
A Pulse's privacy setting: anonymous, attributed, or confidential.
_Avoid_: Privacy level

**Minimum group size**:
The smallest number of contributors (N) any shown aggregate, comment, theme, or breakdown must have.
_Avoid_: Threshold (ambiguous), k

## Answering

**Invitation**:
One eligible member's single-use ticket to answer one Round, carrying an unguessable token.
_Avoid_: Link, ticket, request

**Participation record**:
The fact that a member answered a Round, held apart from what they answered.
_Avoid_: Completion, response (ambiguous)

**Submission**:
The set of Answers given in one Round by one respondent. In anonymous Rounds it carries no Person and no time.
_Avoid_: Response, entry, reply

**Answer**:
One value for one Question version within a Submission.
_Avoid_: Response, value

**Edit key**:
A random secret held only by a member's browser that lets them change their anonymous Submission.
_Avoid_: Token (that is the Invitation's)

**Contributor**:
A Submission counted toward one shown aggregate, because it gave that Question (or that Dimension's Questions) a value. The minimum group size counts Contributors per aggregate.
_Avoid_: Respondent, responder

## Understanding and acting

**Result**:
The derived, recomputable aggregate of a closed Round: scores, response rate, and Comment themes.
_Avoid_: Report, analytics, stats

**Typical change**:
How much a Team's score for one Question or Dimension usually moves from one Round to the next, judged from the Team's own history. A change well beyond it is shown as larger than usual.
_Avoid_: Significance, noise threshold, variance

**Redaction**:
Replacing names of the Organization's People, contact details, handles, and links in a comment with placeholders before anyone can read it.
_Avoid_: Anonymization, scrubbing, masking

**Comment theme**:
A machine-written summary of a group of comments, with a label, sentiment, count, and redacted quotes.
_Avoid_: Cluster, topic, insight

**Action**:
A commitment the Team makes in response to a Result, with an owner, a due date, and a status.
_Avoid_: Action item, task, todo

**Note**:
The Lead's free-text summary of a team discussion, visible to the Team.
_Avoid_: Comment (that is free text in an Answer)
