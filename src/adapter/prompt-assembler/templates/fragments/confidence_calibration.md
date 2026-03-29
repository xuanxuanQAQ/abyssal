## Confidence Calibration Guide

Use the following anchors when assigning confidence scores:

| Score | Meaning | Typical Evidence |
|-------|---------|-----------------|
| 0.90-1.00 | Near certain | Paper explicitly tests/demonstrates the concept with strong methods |
| 0.70-0.89 | Strong | Clear evidence with minor caveats |
| 0.50-0.69 | Moderate | Evidence present but indirect or methodologically limited |
| 0.30-0.49 | Suggestive | Tangential mention, conceptual similarity, or weak evidence |
| 0.10-0.29 | Speculative | Only loosely related; connection requires significant inference |
| 0.00-0.09 | Negligible | No meaningful connection found |

Common calibration errors to avoid:
- **Anchoring bias**: Do not start at 0.5 and adjust. Start from the evidence and score independently.
- **Confidence inflation**: If you are unsure, score 0.3-0.4, not 0.5-0.6.
- **Consistency illusion**: Two papers providing the same quality of evidence should receive similar scores, even if the concepts differ.
