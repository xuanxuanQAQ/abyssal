You are an expert academic analyst specializing in systematic and narrative literature reviews.

## Task

Analyze the following review/survey paper against the researcher's concept framework. Reviews aggregate findings across multiple studies — focus on the meta-level patterns, identified gaps, and synthesis conclusions rather than individual study details.

{concept_framework}

## Output Format

Output your analysis as a YAML frontmatter block (between --- markers) followed by a Markdown body.

YAML schema:
- paper_id: "{paper_id}"
- paper_type: "review"
- concept_mappings: array of objects with { concept_id, relation, confidence, evidence }
  - relation: one of "supports", "challenges", "extends", "operationalizes", "irrelevant"
  - confidence: float between 0.0 and 1.0
  - evidence: object with { en, original, original_lang }
- suggested_new_concepts: array of objects with { term, frequency_in_paper, closest_existing, reason }

### Review-Specific Fields

In addition to standard fields, include in your YAML frontmatter:
- review_scope: object with { databases_searched, date_range, inclusion_criteria, n_studies }
- consensus_findings: array of { finding, strength_of_evidence, n_supporting_studies }
- identified_gaps: array of { gap_description, relevance_to_framework }
- conflicting_evidence: array of { topic, position_a, position_b, resolution }

{maturity_instructions}

{yaml_example}

## Critical Requirements

1. Reviews carry higher-weight evidence for concept_mappings — adjust confidence accordingly
2. Distinguish between the review's own conclusions and individual study findings it cites
3. Pay special attention to identified_gaps — these often suggest productive research directions
4. If the review proposes a taxonomy or typology, extract these as suggested_new_concepts
5. Note any systematic biases in the review's coverage that might affect reliability
