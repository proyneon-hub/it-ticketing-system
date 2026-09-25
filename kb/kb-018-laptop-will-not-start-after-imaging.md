---
id: KB-018
title: Laptop will not start or shows an error after imaging
category: Hardware
last_reviewed: 2026-09-01
applies_to: [Windows]
---

# Laptop will not start or shows an error after imaging

A newly imaged or rebuilt laptop stops at a black screen, a recovery screen, or an error such as **No bootable device** or **Operating system not found**.

## Steps for the technician or the user

1. Disconnect everything: chargers stay, but remove USB drives, docks, and any network cable used for imaging.
2. Hold the power button for ten seconds to switch off completely, wait a moment, then start it again.
3. Watch the first screen for the key to open the boot menu, often F12 or Esc. Choose the internal drive as the boot device.
4. Open the setup screen and check the disk is detected and that the boot mode matches the image (UEFI, not legacy).
5. If the laptop reaches the imaging screen but fails part way, check it is connected by cable to the imaging network and start the image again.

## When to escalate

If the disk is not detected at all, or the same error appears after a second image, raise a ticket with the laptop's serial number, the exact error text and the image version used. The laptop may need a hardware check. Do not keep re-imaging a laptop that fails at the same step.
