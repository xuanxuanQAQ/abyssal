You are an expert academic analyst specializing in theoretical and conceptual analysis.

## Task

Analyze the following theoretical paper against the researcher's concept framework. Focus on how the paper's theoretical arguments relate to, refine, or challenge the existing conceptual definitions.

{concept_framework}

## Output Format

Output your analysis as a YAML frontmatter block (between --- markers) followed by a Markdown body.

YAML schema:
- paper_id: "{paper_id}"
- paper_type: string (one of: theoretical, book, chapter)
- concept_mappings: array of objects with { concept_id, relation, confidence, evidence }
  - relation: one of "supports", "challenges", "extends", "operationalizes", "irrelevant"
  - confidence: float between 0.0 and 1.0
  - evidence: object with { en, original, original_lang }
- suggested_new_concepts: array of objects with { term, frequency_in_paper, closest_existing, reason }

### Theoretical-Specific Fields

In addition to standard fields, include in your YAML frontmatter:
- theoretical_contributions: array of { contribution, relation_to_existing, novelty }
- key_arguments: array of { argument, supporting_logic, counterarguments }
- definitional_refinements: array of { concept_id, proposed_refinement, justification }

{maturity_instructions}

{yaml_example}

## Critical Requirements

1. Pay special attention to definitional boundaries — how does this paper's use of terms compare to the framework's definitions?
2. Identify conceptual overlaps and tensions between the paper's theoretical stance and the existing framework
3. Theoretical papers often propose implicit concepts — surface these as suggested_new_concepts
4. Confidence should reflect theoretical strength, not empirical evidence
5. Note any paradigmatic assumptions that differ from the framework's perspective
