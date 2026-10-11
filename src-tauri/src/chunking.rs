use regex::Regex;

const MAX_CHARS: usize = 2800;
const OVERLAP_CHARS: usize = 300;

pub fn chunk_exam_text(text: &str) -> Vec<String> {
    let cleaned = clean_text(text);

    let question_re =
        Regex::new(
            r"(?i)^\s*Q(?:uestion)?\s*(\d{1,3})[\.\):\-]?\s*(?:\(([a-z])\))?\s*(?:\(([ivxlcdm]+)\))?"
        )
        .unwrap();

    let letter_re =
        Regex::new(r"^\s*\(([a-z])\)\s*")
            .unwrap();

    let roman_re =
        Regex::new(
            r"(?i)^\s*\(([ivxlcdm]+)\)\s*"
        )
        .unwrap();

    let mut chunks = Vec::new();

    let mut current_text = String::new();

    let mut current_question:
        Option<String> = None;

    let mut current_letter:
        Option<String> = None;

    let mut current_roman:
        Option<String> = None;

    let flush = |
        chunks: &mut Vec<String>,
        text: &mut String,
        label: Option<String>,
    | {
        let trimmed = text.trim();

        if trimmed.is_empty() {
            text.clear();
            return;
        }

        let labelled = match label {
            Some(label) => {
                format!(
                    "[Question {}]\n{}",
                    label,
                    trimmed
                )
            }

            None => trimmed.to_string(),
        };

        split_large_chunk(
            &labelled,
            chunks,
        );

        text.clear();
    };

    for line in cleaned.lines() {
        let trimmed = line.trim();

        if trimmed.is_empty() {
            if !current_text.ends_with('\n') {
                current_text.push('\n');
            }

            continue;
        }

        //
        // Q1 / Q1(a) / Q1(a)(ii)
        //
        if let Some(caps) =
            question_re.captures(trimmed)
        {
            let label =
                build_label(
                    caps.get(1)
                        .map(|v| v.as_str()),
                    caps.get(2)
                        .map(|v| v.as_str()),
                    caps.get(3)
                        .map(|v| v.as_str()),
                );

            flush(
                &mut chunks,
                &mut current_text,
                current_label(
                    &current_question,
                    &current_letter,
                    &current_roman,
                ),
            );

            current_question =
                caps.get(1)
                    .map(|v| {
                        format!(
                            "Q{}",
                            v.as_str()
                        )
                    });

            current_letter =
                caps.get(2)
                    .map(|v| {
                        v.as_str()
                            .to_lowercase()
                    });

            current_roman =
                caps.get(3)
                    .map(|v| {
                        v.as_str()
                            .to_lowercase()
                    });

            current_text.push_str(
                &format!(
                    "{}\n",
                    trimmed
                )
            );

            println!(
                "Detected question: {}",
                label
            );

            continue;
        }

        //
        // (a), (b), (c)
        //
        if current_question.is_some() {
            if let Some(caps) =
                letter_re.captures(trimmed)
            {
                flush(
                    &mut chunks,
                    &mut current_text,
                    current_label(
                        &current_question,
                        &current_letter,
                        &current_roman,
                    ),
                );

                current_letter =
                    caps.get(1)
                        .map(|v| {
                            v.as_str()
                                .to_lowercase()
                        });

                current_roman = None;

                current_text.push_str(
                    &format!(
                        "{}\n",
                        trimmed
                    )
                );

                continue;
            }
        }

        //
        // (i), (ii), (iii)
        //
        if current_question.is_some()
            && current_letter.is_some()
        {
            if let Some(caps) =
                roman_re.captures(trimmed)
            {
                flush(
                    &mut chunks,
                    &mut current_text,
                    current_label(
                        &current_question,
                        &current_letter,
                        &current_roman,
                    ),
                );

                current_roman =
                    caps.get(1)
                        .map(|v| {
                            v.as_str()
                                .to_lowercase()
                        });

                current_text.push_str(
                    &format!(
                        "{}\n",
                        trimmed
                    )
                );

                continue;
            }
        }

        current_text.push_str(trimmed);
        current_text.push('\n');
    }

    flush(
        &mut chunks,
        &mut current_text,
        current_label(
            &current_question,
            &current_letter,
            &current_roman,
        ),
    );

    //
    // If we found almost no question
    // structure, fall back to normal
    // overlapping chunking.
    //
    if chunks.len() <= 1 {
        return fallback_chunks(
            &cleaned
        );
    }

    chunks
}

fn current_label(
    question: &Option<String>,
    letter: &Option<String>,
    roman: &Option<String>,
) -> Option<String> {
    let mut label =
        question.clone()?;

    if let Some(letter) = letter {
        label.push_str(
            &format!("({})", letter)
        );
    }

    if let Some(roman) = roman {
        label.push_str(
            &format!("({})", roman)
        );
    }

    Some(label)
}

fn build_label(
    question: Option<&str>,
    letter: Option<&str>,
    roman: Option<&str>,
) -> String {
    let mut result =
        format!(
            "Q{}",
            question.unwrap_or("?")
        );

    if let Some(letter) = letter {
        result.push_str(
            &format!("({})", letter)
        );
    }

    if let Some(roman) = roman {
        result.push_str(
            &format!("({})", roman)
        );
    }

    result
}

fn clean_text(text: &str) -> String {
    text.lines()
        .filter(|line| {
            let trimmed = line.trim();

            !trimmed.is_empty()
                || !line.is_empty()
        })
        .filter(|line| {
            let lower =
                line.trim()
                    .to_lowercase();

            !lower.starts_with(
                "index no."
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn split_large_chunk(
    text: &str,
    output: &mut Vec<String>,
) {
    if text.len() <= MAX_CHARS {
        output.push(
            text.to_string()
        );

        return;
    }

    let chars: Vec<char> =
        text.chars().collect();

    let mut start = 0;

    while start < chars.len() {
        let end =
            (start + MAX_CHARS)
                .min(chars.len());

        let chunk: String =
            chars[start..end]
                .iter()
                .collect();

        if !chunk.trim().is_empty() {
            output.push(chunk);
        }

        if end == chars.len() {
            break;
        }

        start =
            end.saturating_sub(
                OVERLAP_CHARS
            );
    }
}

fn fallback_chunks(text: &str) -> Vec<String> {
    chunk_by_paragraphs(
        text,
        1800,
        220,
    )
}

fn chunk_by_paragraphs(
    text: &str,
    target_chars: usize,
    overlap_chars: usize,
) -> Vec<String> {
    let normalized =
        text.replace("\r\n", "\n")
            .replace('\r', "\n");

    let paragraphs: Vec<&str> =
        normalized
            .split("\n\n")
            .map(str::trim)
            .filter(|p| !p.is_empty())
            .collect();

    let mut chunks = Vec::new();
    let mut current = String::new();

    for paragraph in paragraphs {
        if current.len()
            + paragraph.len()
            + 2
            <= target_chars
        {
            if !current.is_empty() {
                current.push_str("\n\n");
            }

            current.push_str(paragraph);
            continue;
        }

        if !current.trim().is_empty() {
            chunks.push(
                current.trim().to_string()
            );
        }

        let overlap = chunks
            .last()
            .map(|last| {
                tail_chars(
                    last,
                    overlap_chars,
                )
            })
            .unwrap_or_default();

        current = overlap;

        if !current.is_empty() {
            current.push_str("\n\n");
        }

        if paragraph.len() <= target_chars {
            current.push_str(paragraph);
        } else {
            for piece in split_by_chars(
                paragraph,
                target_chars,
            ) {
                if !current.trim().is_empty() {
                    chunks.push(
                        current
                            .trim()
                            .to_string()
                    );
                }

                chunks.push(
                    piece.to_string()
                );

                current =
                    tail_chars(
                        piece,
                        overlap_chars,
                    );
            }
        }
    }

    if !current.trim().is_empty() {
        chunks.push(
            current.trim().to_string()
        );
    }

    chunks
}

fn tail_chars(
    text: &str,
    count: usize,
) -> String {
    let chars: Vec<char> =
        text.chars().collect();

    let start =
        chars.len()
            .saturating_sub(count);

    chars[start..]
        .iter()
        .collect()
}

fn split_by_chars(
    text: &str,
    max_chars: usize,
) -> Vec<&str> {
    if text.len() <= max_chars {
        return vec![text];
    }

    let mut out = Vec::new();
    let mut start = 0;

    while start < text.len() {
        let mut end =
            (start + max_chars)
                .min(text.len());

        while !text.is_char_boundary(end) {
            end -= 1;
        }

        out.push(
            &text[start..end]
        );

        start = end;
    }

    out
}