# An Organization admin may add themselves to a Team, visibly

Extends ADR 0003, which gives the Organization admin role no access to any Team's Results: access needs a Membership in that Team. ADR 0003 did not say whether an admin may create such a Membership for themselves. They may (PR #58, follow-up to #38 and #40).

An admin who adds themselves gets an ordinary Membership with a role and a start date. It is always listed in the Team's roster with that role and start date, so members can see who has joined. The admin gains Results access only through that visible Membership, and ADR 0003 is otherwise unchanged. This avoids a side door while not stopping admins in small organisations from taking part in their own Team.

PR #58 also settled two neighbouring rules. Only an Organization admin may restore a removed Person to a Team; a Lead who adds a removed Person's email gets `PersonWasRemoved` (HTTP 403). Nobody may remove themselves from the Organization (HTTP 403); another admin may remove an admin.
