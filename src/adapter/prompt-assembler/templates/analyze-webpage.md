## Task: Web Content Analysis

Analyze this web-sourced document (policy document, government notice, news article, blog post, or other online content) against the researcher's concept framework. This is NOT a peer-reviewed academic paper — adjust your analytical lens accordingly.

### Concept Framework

{concept_framework}

### Analysis Requirements

For each concept mapping:
- **relation**: How does this document relate to the concept?
  - `supports` — provides real-world evidence, data, or policy action consistent with the concept
  - `challenges` — presents facts or positions that contradict the concept
  - `extends` — introduces practical dimensions or applications beyond the concept's current scope
  - `operationalizes` — demonstrates concrete implementation, regulation, or measurement of the concept
  - `irrelevant` — no meaningful connection
- **confidence**: Your certainty about this mapping (0.0-1.0). Web content typically warrants lower confidence than peer-reviewed research — calibrate accordingly.
- **evidence**: Specific textual evidence from the document

### Web Content-Specific Requirements

In addition to concept mappings, extract:

1. **Source Assessment**:
   - `author_type`: "government_agency" | "news_outlet" | "think_tank" | "corporation" | "individual_expert" | "anonymous" | "unknown"
   - `document_type`: "policy" | "regulation" | "notice" | "news" | "opinion" | "blog" | "report" | "press_release" | "other"
   - `credibility`: "high" (official government, authoritative institution) | "moderate" (established media, known experts) | "low" (anonymous, unverified) | "unknown"
   - `bias_indicators`: List any detectable biases, institutional interests, or one-sided framing.

2. **Core Claims**: Each central assertion or policy position. For each:
   - `claim`: One-sentence statement.
   - `evidence_basis`: "data-backed" | "expert-cited" | "regulation-based" | "anecdotal" | "assertion-only"
   - `strength`:
     - `strong` = backed by concrete data, official sources, or enforceable regulations
     - `moderate` = reasonable but with limited supporting evidence
     - `weak` = opinion, vague claims, or unsubstantiated assertions

3. **Practical Implications**: Who is affected and how? List key stakeholders and the real-world impact of the document's content.

4. **Temporal Relevance**: Note any dates, deadlines, or time-sensitive elements. Is this content still current or potentially outdated?

{suggested_concepts_instruction}

{output_format}

{bilingual_evidence}

{confidence_calibration}

{language_instruction}
