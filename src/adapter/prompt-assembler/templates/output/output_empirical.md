## Output Format

Output your analysis as a YAML frontmatter block (between --- markers) followed by a Markdown body.

### YAML Schema

```yaml
---
paper_id: "{paper_id}"
paper_type: "journal" | "conference" | "preprint" | "unknown"
concept_mappings:
  - concept_id: "concept_identifier"
    relation: "supports" | "challenges" | "extends" | "operationalizes" | "irrelevant"
    confidence: 0.75
    evidence:
      en: "English evidence text"
      original: "Original language text"
      original_lang: "zh-CN"
suggested_new_concepts:
  - term: "concept_name"
    frequency_in_paper: 5
    closest_existing: "related_concept_id"
    reason: "Why this concept matters"
core_claims:
  - claim: "One-sentence finding"
    evidence_type: "experimental" | "correlational" | "observational" | "computational" | "mixed"
    strength: "strong" | "moderate" | "weak"
methodology:
  design: "Research design description"
  sample: "N=120 university students, convenience sampling"
  measures: "Key instruments"
  validity_concerns: "Threats to validity"
limitations:
  - "First limitation you identify"
  - "Second limitation you identify"
---
```

### Complete Example

```yaml
---
paper_id: "{paper_id}"
paper_type: "journal"
concept_mappings:
  - concept_id: "theory_of_mind"
    relation: "supports"
    confidence: 0.85
    evidence:
      en: >
        The authors demonstrate that participants who scored higher on
        ToM tasks also showed greater sensitivity to avatar behavioral
        cues (p < .01, d = 0.72)
      original: >
        ToM任务得分较高的参与者对虚拟化身行为线索的敏感性也更高
        （p < .01, d = 0.72）
      original_lang: "zh-CN"
suggested_new_concepts:
  - term: "behavioral_expectation_mismatch"
    frequency_in_paper: 8
    closest_existing: "uncanny_valley"
    reason: "Extends uncanny valley theory to behavioral rather than visual domain"
core_claims:
  - claim: "Behavioral realism predicts social presence more strongly than visual realism"
    evidence_type: "experimental"
    strength: "strong"
methodology:
  design: "2x3 between-subjects experiment with VR headset"
  sample: "N=120 university students, convenience sampling"
  measures: "Networked Minds Social Presence Inventory, custom behavioral realism scale"
  validity_concerns: "Student sample limits generalizability; single VR platform"
limitations:
  - "All behavioral cues were pre-scripted rather than responsive, limiting ecological validity"
  - "No longitudinal follow-up to assess whether social presence effects persist beyond novelty"
---
```
