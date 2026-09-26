# Knowledge-base search: does the right article come up?

Measured on 2026-09-25 against the 62 golden tickets that an article resolves (of 108). No model was used: this is the text index alone.

| Query | First result right | Right one in the top 3 | Right one in the top 5 | Mean reciprocal rank |
| ----- | ------------------ | ---------------------- | ---------------------- | -------------------- |
| title | 88.7% (55/62) | 91.9% (57/62) | 91.9% (57/62) | 0.901 |
| title and description | 85.5% (53/62) | 93.5% (58/62) | 95.2% (59/62) | 0.894 |

## Not first, by title (7)

- T005: wanted KB-010, not in the top results (KB-029, KB-021, KB-009, KB-013, KB-019)
- T023: wanted KB-003, not in the top results (KB-004, KB-028, KB-019, KB-027, KB-007)
- T026: wanted KB-019, it was number 2 (KB-023, KB-019, KB-015, KB-013, KB-030)
- T055: wanted KB-014, it was number 3 (KB-018, KB-015, KB-014, KB-011, KB-016)
- T065: wanted KB-020, not in the top results (KB-014, KB-009, KB-023, KB-030, KB-031)
- T073: wanted KB-003, not in the top results (KB-004, KB-028, KB-019, KB-027, KB-007)
- T076: wanted KB-011, not in the top results (no results)

## Not first, by title and description (9)

- T001: wanted KB-006, it was number 2 (KB-008, KB-006, KB-021, KB-009, KB-024)
- T023: wanted KB-003, it was number 2 (KB-004, KB-003, KB-028, KB-027, KB-019)
- T026: wanted KB-019, not in the top results (KB-015, KB-018, KB-031, KB-023, KB-007)
- T048: wanted KB-006, it was number 3 (KB-008, KB-009, KB-006, KB-007, KB-031)
- T060: wanted KB-015, it was number 2 (KB-027, KB-015, KB-029, KB-026, KB-025)
- T073: wanted KB-003, not in the top results (KB-004, KB-027, KB-028, KB-019, KB-007)
- T075: wanted KB-019, it was number 4 (KB-018, KB-021, KB-015, KB-019, KB-028)
- T076: wanted KB-011, not in the top results (no results)
- T107: wanted KB-016, it was number 3 (KB-001, KB-028, KB-016, KB-030, KB-024)
