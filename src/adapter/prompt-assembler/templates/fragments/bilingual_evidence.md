## Bilingual Evidence Format

For each concept_mapping, the `evidence` field must use the following structure:

```json
{
  "en": "English expression of the evidence (used for cross-language alignment)",
  "original": "论文原文片段 (preserved in the original language for researcher verification)",
  "original_lang": "zh-CN",
  "chunk_id": null,
  "page": null,
  "annotation_id": null
}
```

Rules:
- If the paper is in English, `en` and `original` contain the same text.
- If the paper is in another language (Chinese, Japanese, etc.):
  - `en`: Your English translation/paraphrase of the key evidence passage.
  - `original`: The exact text from the paper in its original language.
  - `original_lang`: ISO language code (zh-CN, ja, ko, de, fr, etc.)
- Academic terminology should be preserved in its original form in the `en` field with the original term in parentheses when significant. Example: "The concept of 'face' (面子) as used in Chinese social psychology differs from Goffman's dramaturgical 'face'."
