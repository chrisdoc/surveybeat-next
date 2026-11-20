export const legalPrivacyCatalog = {
  "legal.privacy.title": "Privacy Notice",
  "legal.privacy.description":
    "What personal data SurveyBeat processes, why, on what legal basis, for how long, who receives it and which rights you have.",
  "legal.privacy.lede":
    "This notice is the information that GDPR Articles 13 and 14 require. It applies to the SurveyBeat website, the app and the answer page. Effective {effective}.",
  "legal.privacy.s01.title": "Who is responsible",
  "legal.privacy.s01.p1":
    "SurveyBeat runs surveybeat.app. The legal name and postal address of the operator are not published on this page yet. For anything about privacy, including requests under the GDPR, write to {email}.",
  "legal.privacy.s01.p2":
    "SurveyBeat has two roles, and they decide who answers your request. The next section explains them.",
  "legal.privacy.s02.title": "Two roles: processor and controller",
  "legal.privacy.s02.p1":
    "Your Organization is the controller of the data about its People, Teams, Pulses, Rounds and Submissions. It decides why and how that data is used. SurveyBeat is its processor under Article 28 and acts only on its instructions, set out in the Data Processing Agreement. If you are asked to answer a Pulse, your Organization is the controller for your data, and you should send requests about it to your Organization. SurveyBeat helps it answer them.",
  "legal.privacy.s02.p2":
    "SurveyBeat is the controller for signing in, for keeping the service secure and preventing abuse, for the SurveyBeat website, and for the sign-in emails it sends to you.",
  "legal.privacy.s03.title": "What we process, why, and for how long",
  "legal.privacy.s03.p1":
    "Each row names the data, the purpose, the legal basis under Article 6(1) and how long the data is kept. For data held for an Organization, the Organization chooses the legal basis, usually legitimate interests (point f) in understanding how its Teams are doing, and the row shows the basis it normally relies on.",
  "legal.privacy.s03.th.data": "Data",
  "legal.privacy.s03.th.purpose": "Purpose",
  "legal.privacy.s03.th.basis": "Legal basis",
  "legal.privacy.s03.th.retention": "Kept for",
  "legal.privacy.s03.tsignin.data":
    "Sign-in: your email address, the one-time code or sign-in link we send, the session (IP address, browser user agent, expiry) and a passkey's public key if you add one. SurveyBeat is the controller.",
  "legal.privacy.s03.tsignin.purpose": "Let you sign in, keep your session safe and detect abuse.",
  "legal.privacy.s03.tsignin.basis":
    "Point b, to provide the service you use. Point f, legitimate interests, for security and abuse prevention.",
  "legal.privacy.s03.tsignin.retention":
    "A code or link for {codeMinutes} minutes. A session for up to {sessionDays} days. The sign-in record while you belong to an Organization, and until it is deleted after that.",
  "legal.privacy.s03.tpeople.data":
    "People and Teams: email address, role, Team Membership, time zone and language, whether you turned off reminders for a Pulse, and the Invitations sent to you (stored as a hash, never the link). The Organization is the controller.",
  "legal.privacy.s03.tpeople.purpose":
    "Run Teams and Pulses, send Invitations and reminders, and count how many people took part.",
  "legal.privacy.s03.tpeople.basis": "Point f, legitimate interests of your Organization.",
  "legal.privacy.s03.tpeople.retention":
    "While you are a Person in the Organization. When a Person is removed, their personal data is deleted on request, and the Organization's Teams keep their Results.",
  "legal.privacy.s03.tparticipation.data":
    "Participation records: that a Person answered a Round. They hold no answers and no time. The Organization is the controller.",
  "legal.privacy.s03.tparticipation.purpose":
    "Count the response rate and stop a second Submission from the same Person.",
  "legal.privacy.s03.tparticipation.basis": "Point f, legitimate interests of your Organization.",
  "legal.privacy.s03.tparticipation.retention":
    "While the Person exists. Deleting the Person deletes their Participation records.",
  "legal.privacy.s03.tanswers.data":
    "Answers and comments in anonymous Submissions. They carry no Person and no time. Comments have names of People, email addresses, phone numbers, handles and links removed before they are stored.",
  "legal.privacy.s03.tanswers.purpose":
    "Show a Team's combined Results, trends and comment themes to the people allowed to see them.",
  "legal.privacy.s03.tanswers.basis":
    "Anonymous Submissions are not personal data (see the next section). Where a comment still identifies someone, point f applies.",
  "legal.privacy.s03.tanswers.retention":
    "The policy is {rawMonths} months for raw Answers and comments, unless the Organization sets another period. Automatic deletion on that schedule is not in place yet, so they stay with the Pulse until it is. Aggregated Results may be kept longer. Backups are kept for {restoreDays} days.",
  "legal.privacy.s03.tresults.data":
    "Results, Lead's Notes and Actions: scores, response rates, comment themes, the Lead's Note and Actions with an owner and a due date. The Organization is the controller.",
  "legal.privacy.s03.tresults.purpose": "Let a Team talk about its Results and agree what to change.",
  "legal.privacy.s03.tresults.basis": "Point f, legitimate interests of your Organization.",
  "legal.privacy.s03.tresults.retention":
    "While the Organization keeps the Pulse. Results show nothing below the minimum group size.",
  "legal.privacy.s03.temail.data":
    "Email: the recipient address, the message and its delivery state for Invitations, reminders, Results and added-to-Team notices (Organization controller), and for sign-in messages (SurveyBeat controller).",
  "legal.privacy.s03.temail.purpose": "Deliver the message and show a Lead which sends failed and why.",
  "legal.privacy.s03.temail.basis": "Point f for Invitations and notices. Point b for sign-in messages.",
  "legal.privacy.s03.temail.retention":
    "Delivery records while the Organization exists. Sign-in codes and links expire after {codeMinutes} minutes.",
  "legal.privacy.s03.tlogs.data":
    "Technical logs: IP address and request details seen by the app's Worker, in a sample Cloudflare keeps. The Submission Worker, which receives anonymous answers, keeps no logs at all. SurveyBeat is the controller.",
  "legal.privacy.s03.tlogs.purpose": "Keep the service running and secure.",
  "legal.privacy.s03.tlogs.basis": "Point f, legitimate interests in security and reliability.",
  "legal.privacy.s03.tlogs.retention": "A short period set by Cloudflare's log retention, measured in days.",
  "legal.privacy.s03.tsite.data":
    "This website: static pages only, with no analytics, no advertising and no tracking. Cloudflare sees your IP address to deliver the page.",
  "legal.privacy.s03.tsite.purpose": "Deliver the page.",
  "legal.privacy.s03.tsite.basis": "Point f, legitimate interests in running the website.",
  "legal.privacy.s03.tsite.retention": "SurveyBeat keeps nothing from a visit.",
  "legal.privacy.s04.title": "Anonymous Submissions are not personal data",
  "legal.privacy.s04.p1":
    "An anonymous Submission stores its Round, its Answers and a hash of an Edit key. It stores no Person, no Invitation and no time at all, not even the day. The Participation record, which says that a Person answered, is kept apart from it. We cannot match one to the other, and neither can your Lead or your Organization's admins.",
  "legal.privacy.s04.p2":
    "Because no one can link such a Submission to a Person, it is anonymous data under Recital 26 of the GDPR and not personal data. For that reason it stays when a Person is deleted. Deleting you removes your Participation records and your other personal data. It does not remove the Submissions you gave.",
  "legal.privacy.s04.p3":
    "We do not claim to defend against everything. Database backups are kept for {restoreDays} days so that we can recover from a disaster. Restoring one replays every write, including the one transaction that writes a Participation record and a Submission together. Only named SurveyBeat operators can start a restore, and no Organization admin or Lead can. We also cannot read Cloudflare's own edge logs.",
  "legal.privacy.s04.p4":
    "Pulses run in anonymous mode only. If SurveyBeat offers a mode that stores a name with an answer, it will say so here and on the answer page before anyone can use it.",
  "legal.privacy.s05.title": "Comments and AI processing",
  "legal.privacy.s05.p1":
    "A comment is redacted when it is stored: names of People in the Organization, email addresses, phone numbers, handles and links are replaced with placeholders. The original text is not kept. Redaction follows patterns and cannot promise that free text never identifies anyone, so leave out anything that could identify you.",
  "legal.privacy.s05.p2":
    "AI processing is off until an Organization admin turns it on. While it is on, a request can include the Question text, each Question's dimension, score, change and whether that change is larger than usual, the same figures for each Dimension, redacted comment text tied to a Question position, and the redacted titles of open Actions. It does not include a name, a Person, a Team, a Round or a time. The service runs in the EU, keeps no prompts or output, and cannot fall back to another provider. If it is unavailable, the request waits and is retried. The answer page and the Invitation tell members when AI processing is on. The AI service only summarises. Nothing about a Person is decided by it.",
  "legal.privacy.s06.title": "Where the data comes from, and whether you must provide it",
  "legal.privacy.s06.p1":
    "Your email address and Team Membership come from your Organization, which added you, as Article 14 requires us to tell you. Everything you answer comes from you.",
  "legal.privacy.s06.p2":
    "You are never required to answer a Pulse through SurveyBeat. To sign in you must give an email address, and without one you cannot sign in. Whatever your Organization expects of you beyond that is its own matter.",
  "legal.privacy.s06.p3":
    "SurveyBeat makes no decision about you based only on automated processing that has legal or similarly significant effects (Article 22).",
  "legal.privacy.s07.title": "Who receives data",
  "legal.privacy.s07.p1":
    "Your Organization's Leads and admins see what their role allows. A Lead sees combined Results, never who answered what. An Organization admin sees no Team's Results.",
  "legal.privacy.s07.p2":
    "SurveyBeat uses processors to run the service: Cloudflare, Inc. for hosting, storage and email delivery, and, only when an Organization admin turns on AI processing, OpenRouter, Inc., which routes the call to Google Cloud (google-vertex/europe) or Amazon Web Services (amazon-bedrock/eu-west-1). The Sub-processors page names each one, with its purpose, location and transfer basis.",
  "legal.privacy.s08.title": "Transfers outside the EU and EEA",
  "legal.privacy.s08.p1":
    "Cloudflare is a US company and runs a global network, so data it hosts for us can be processed outside the EU and EEA. We rely on the EU Standard Contractual Clauses in its data processing terms and, where the recipient is certified, on the EU–US Data Privacy Framework.",
  "legal.privacy.s08.p2":
    "Comment text for AI processing is sent only to endpoints in the EU. OpenRouter's own account and abuse-monitoring data can be processed in the US, and comment text is not part of it. A copy of the safeguards is available from {email}.",
  "legal.privacy.s09.title": "Cookies and browser storage",
  "legal.privacy.s09.p1":
    "SurveyBeat sets one cookie and uses browser storage for a few functions you ask for. It uses no advertising, tracking or analytics cookies. Everything below is strictly necessary for a function you requested, so no consent banner is needed.",
  "legal.privacy.s09.th.name": "Name",
  "legal.privacy.s09.th.what": "What it is",
  "legal.privacy.s09.th.kept": "Kept for",
  "legal.privacy.s09.tsession.name": "__Host-surveybeat-session (cookie)",
  "legal.privacy.s09.tsession.what":
    "Keeps you signed in to the app. It is HttpOnly, Secure, SameSite=Lax and only for the app's own host.",
  "legal.privacy.s09.tsession.kept": "Up to {sessionDays} days, or until you sign out.",
  "legal.privacy.s09.tedit.name": "sb_edit_… (browser local storage)",
  "legal.privacy.s09.tedit.what":
    "Your Edit key for a Round, a random secret that lets you change your anonymous answers from this browser. It never leaves the browser except as a hash.",
  "legal.privacy.s09.tedit.kept":
    "Until you clear site data. If you lose it, your answers can no longer be changed.",
  "legal.privacy.s09.tkept.name": "sb_answers_… (browser local storage)",
  "legal.privacy.s09.tkept.what":
    "The answers and comments you gave, for your private history page. They stay on this device, and comments are kept as you typed them.",
  "legal.privacy.s09.tkept.kept":
    "{keptYears} year. You can clear them any time with Clear my answers on this device on the My history page.",
  "legal.privacy.s09.ttoken.name": "sb_token (browser session storage)",
  "legal.privacy.s09.ttoken.what":
    "Your Invitation token while the answer page is open in a tab, so reloading the page keeps working.",
  "legal.privacy.s09.ttoken.kept": "Until you save your answers or close the tab.",
  "legal.privacy.s10.title": "Your rights",
  "legal.privacy.s10.p1": "Under Articles 15 to 22 of the GDPR you have the right to:",
  "legal.privacy.s10.li1": "get access to your personal data and a copy of it (Article 15)",
  "legal.privacy.s10.li2": "have wrong data corrected (Article 16)",
  "legal.privacy.s10.li3": "have your data erased (Article 17)",
  "legal.privacy.s10.li4": "have its use restricted (Article 18)",
  "legal.privacy.s10.li5": "receive it in a common format and have it passed on (Article 20)",
  "legal.privacy.s10.li6":
    "object to processing based on legitimate interests (Article 21), and not be subject to a decision based only on automated processing (Article 22)",
  "legal.privacy.s10.p2":
    "You can do some of this yourself. The My history page lists the Rounds you took part in and clears your answers from this device. Your Organization's admins can remove you. For everything else, write to {email} or to your Organization. If your Organization is the controller, we pass your request to it without delay and help it answer. We answer within {responseDays} days. If a request is complex we tell you why and when you will get the answer, within the period the GDPR allows.",
  "legal.privacy.s10.p3":
    "Anonymous Submissions cannot be found, exported or deleted for one Person, because nothing links them to you. That is the point of the design.",
  "legal.privacy.s10.p4":
    "We do not rely on your consent for any processing, so there is no consent to withdraw.",
  "legal.privacy.s11.title": "Complaints",
  "legal.privacy.s11.p1":
    "You can complain to a data protection supervisory authority, in particular in the EU Member State where you live or work or where you think the GDPR was breached. The European Data Protection Board lists the authorities at edpb.europa.eu. We would like to hear from you first, so we can put it right.",
  "legal.privacy.s12.title": "Security",
  "legal.privacy.s12.p1":
    "Each Organization's data sits in its own Durable Object, and Organizations never share records. Tokens are stored only as hashes. Traffic is encrypted in transit and storage is encrypted at rest by Cloudflare. Nothing below the minimum group size is shown. It is {groupSize} by default and an Organization can raise it, never below {minimum}. The Data Processing Agreement lists the measures in full.",
  "legal.privacy.s13.title": "Changes to this notice",
  "legal.privacy.s13.p1":
    "When we change this notice in a way that matters to you, we update the date above and tell Organization admins by email before the change takes effect.",
} as const;
