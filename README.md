# PrepBuddy (prototype)

Students upload their own ebook (PDF). PrepBuddy finds the chapters on their device, then makes fresh exam-style practice questions for any chapter, on demand.

## How it works

- `index.html`, `js/` – the app. Runs in the browser; books, questions and progress are stored on the student's device (IndexedDB / localStorage). No sign-in yet.
- `js/book.js` – reads the PDF with PDF.js (`vendor/`) and splits it into chapters: PDF bookmarks first, then numbered headings ("2.1 Water"), then 8-page blocks.
- `api/generate.js` – Vercel function: writes questions from one chapter's text with Claude.
- `api/verify.js` – Vercel function: checks each question (blind answer + judge against the textbook). Only passing questions reach students.
- `lib/claude.js` – shared prompts and the Claude API call (chapter text is prompt-cached).

## Settings (Vercel → Project → Settings → Environment Variables)

| Name | What |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key from console.anthropic.com |
| `PREPBUDDY_ACCESS_CODE` | Optional. If set, the app asks for this code before making questions (protects your API credit) |
| `PREPBUDDY_MODEL` | Optional. Defaults to `claude-sonnet-5-5` |

## Credits

- Built-in sample questions: OpenStax Biology 2e, CC BY-NC-SA 4.0. Access for free at openstax.org. Non-commercial use only.
- PDF.js (Mozilla), Apache 2.0 – see `vendor/LICENSE-pdfjs.txt`.
