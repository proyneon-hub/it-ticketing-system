---
id: KB-007
title: VPN will not connect or shows an authentication error
category: Network
last_reviewed: 2026-09-01
applies_to: [Windows, macOS]
---

# VPN will not connect or shows an authentication error

The client stays on "connecting", or shows an error about your credentials or a certificate.

## Steps

1. Confirm you have working internet without the VPN by opening a public website.
2. Check the date and time on the laptop are correct and set to automatic. A wrong clock makes certificate errors.
3. Sign in to the company portal in a browser. If that sign-in fails, fix it first with KB-001 or KB-002, because the VPN uses the same account.
4. Approve the MFA prompt promptly when the VPN asks. If no prompt arrives, see KB-004.
5. Quit the VPN client completely and start it again.
6. Restart the laptop and try again.

## Certificate errors after an update

A certificate error that started after an operating system update usually means the VPN client needs updating. Raise a ticket and include the exact wording of the error and your operating system version. Do not install a VPN client from anywhere except the company software portal.
