---
id: KB-012
title: Print jobs stuck in the queue
category: Hardware
last_reviewed: 2026-09-01
applies_to: [Windows]
---

# Print jobs stuck in the queue

Documents sit in the print queue as **Printing** or **Error** and never come out.

## Steps

1. Open the print queue from Settings, Printers and scanners, then choose the printer and **Open queue**.
2. Cancel all documents: in the queue window choose Printer, then **Cancel All Documents**.
3. If a job will not cancel, restart the print service. Search for **Services** in the Start menu, find **Print Spooler**, right-click it and choose **Restart**.
4. Check the printer itself for a paper jam, an empty tray or an error message, and clear it.
5. Print one small test page before sending the big job again.

## Large or unusual jobs

A very large file, or a file in an unusual format, can block the queue. Save it as a PDF and print the PDF, or print a few pages at a time.

If the printer is listed as offline, see KB-011. If you have never used this printer before, see KB-013.
