---
id: KB-024
title: Outlook keeps asking for a password
category: Email
last_reviewed: 2026-09-01
applies_to: [Outlook, Windows, macOS]
---

# Outlook keeps asking for a password

Outlook shows a sign-in box again and again, even after you type the right password.

## Steps

1. Close the sign-in box, then close Outlook completely.
2. Check you can sign in to webmail in a browser with the same account. If that fails, the password has changed or the account is locked: see KB-001 or KB-002.
3. Check the laptop has a working internet connection, and is on the VPN if you are remote and the mailbox needs it.
4. Open Outlook again and sign in once. When asked, approve the MFA prompt (see KB-004 if it does not arrive).
5. If the prompt keeps returning, sign out of your work account in the operating system's account settings, restart the laptop and sign in again.
6. On Windows, open Credential Manager, remove any saved entries whose name contains the mail server or Outlook, and restart Outlook.

## When to raise a ticket

If it still loops, raise a ticket with your Outlook version, whether webmail works, and when it started. If it started right after a password change, also say whether your phone is still using the old password, because that is the usual cause.
