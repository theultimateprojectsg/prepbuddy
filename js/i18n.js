// English / 繁體中文 (Hong Kong) for the app's own buttons, menus and messages.
// Screens are written in English; when Chinese is on, text is swapped as it appears.
// Book content and questions are never translated here (they are already in the book's language).

const EXACT = {
  // home
  'Exam practice from your textbooks': '用你的課本溫習應試',
  'Add a textbook': '加入課本',
  'Find your textbook and practise any chapter': '搵你的課本，練習任何章節',
  'Search by title, subject or book code': '以書名、科目或課本編號搜尋',
  'Search the library': '搜尋課本庫',
  'Find a textbook': '搵課本',
  'My textbooks': '我的課本',
  'No textbooks yet. Search above to add one from the library.': '仲未有課本。喺上面搜尋，從課本庫加入。',
  'Not in the library? Upload your own PDF': '課本庫冇你本書？上載你自己的 PDF',
  'Review across all textbooks': '溫習所有課本',
  'Spaced review': '間隔溫習',
  'Start': '開始',
  'Questions you answer come back here to help you remember them.': '你答過的題目會喺呢度再出現，幫你記得更牢。',
  'Weak topics': '弱項',
  'Questions you found hard': '你覺得難的題目',
  'Mini mock': '小型模擬測驗',
  'Mock paper': '模擬試卷',
  'DSE-style, timed': 'DSE 模式，限時作答',
  'Which textbook?': '哪一本課本？',
  'Practise the questions you found hard.': '練習你覺得難的題目。',
  'You choose the chapters and length next.': '下一步選擇章節和長度。',
  'All my textbooks': '我的所有課本',
  'Introduction': '引言',
  'Checking chapter names…': '正在檢查章節名稱…',
  'Chapter names wrong? Edit chapters': '章節名稱有誤？編輯章節',
  'Edit chapters': '編輯章節',
  'Fix chapter names, merge or split chapters, or hide parts that aren’t for revising (like answers or the index). Your questions and progress are kept.': '修改章節名稱、合併或分拆章節，或隱藏不用溫習的部分（例如答案或索引）。你的題目和進度會保留。',
  'Library books can be renamed, merged or hidden.': '課本庫的課本可以改名、合併或隱藏章節。',
  'Splitting needs the book uploaded again (books uploaded before today can still be renamed, merged or hidden).': '分拆章節需要重新上載課本（之前上載的課本仍可改名、合併或隱藏）。',
  'Merge with next': '與下一章合併',
  'Split': '分拆',
  'Hide': '隱藏',
  'Show': '顯示',
  'Split here': '在這裏分拆',
  'Start a new chapter at page': '新章節由這一頁開始',
  'Done': '完成',
  'Chapter name': '章節名稱',
  'Saved': '已儲存',
  'Chapters merged': '已合併章節',
  'Chapter split. Check the new chapter’s name.': '已分拆章節，請檢查新章節的名稱。',
  'A book needs at least one chapter.': '一本課本最少要有一個章節。',
  'Type': '打字',
  'Write by hand': '手寫',
  'Undo': '復原',
  'Clear': '清除',
  'More space': '加大空間',
  'How to answer': '作答方式',
  'Writing area: write your answer with your finger or a stylus': '書寫區：用手指或觸控筆寫下答案',
  'Mistake book': '錯題簿',
  'Every question you didn’t get fully right is kept here. Get it right again and it moves to Mastered.': '你未完全答對的題目都會收集在這裏。再次答對後會移到「已掌握」。',
  'The answer options are shuffled, so you can’t just remember the letter.': '選項次序已打亂，不能只記住答案字母。',
  'Nothing here. Questions you get wrong will appear here automatically.': '暫時沒有錯題。答錯的題目會自動加到這裏。',
  'Questions you get right after missing them will appear here.': '之前答錯、後來答對的題目會顯示在這裏。',
  'Subject type': '科目類型',
  'Science': '科學',
  'Maths': '數學',
  'Language': '語文',
  'Humanities': '人文學科',
  'Questions test ideas, experiments and data.': '題目考核概念、實驗和數據。',
  'Calculation questions with method marks; a maths keyboard helps you type working.': '計算題設步驟分；數學鍵盤方便你輸入步驟。',
  'Comprehension, vocabulary, grammar and writing tasks marked with a rubric.': '閱讀理解、詞彙、語法及按評分準則批改的寫作題。',
  'Source- and data-based questions, and “to what extent” questions.': '資料題、數據題及「在多大程度上」的評論題。',
  'New questions will suit this subject': '新題目會配合這個科目',
  'Write your answer here': '在這裏寫你的答案',
  'Show your working, one step per line': '寫出步驟，每行一步',
  'Method marks are given for correct working, even if the final answer is wrong.': '即使最終答案錯了，正確的步驟仍可得分。',
  'Not marked': '未批改',
  'Try marking again': '再試批改',
  'Marked by AI against the rubric.': '由 AI 按評分準則批改。',
  'How to improve it': '如何改進',
  'Maths symbols': '數學符號',
  'Writing': '寫作',
  'Tutor (I don’t get it)': 'AI 導師（我不明白）',
  'Notes and flashcards': '筆記及溫習卡',
  'I don’t get it': '我不明白',
  'Ask about this question': '問問這條題目',
  'Close': '關閉',
  'Why is my answer wrong?': '為甚麼我答錯了？',
  'Explain it more simply': '用簡單一點的方法解釋',
  'Go through it step by step': '一步一步解釋',
  'Give me another example': '再給我一個例子',
  'Type your question…': '輸入你的問題…',
  'Send': '傳送',
  'The tutor is not available right now. Try again in a moment.': 'AI 導師暫時未能使用，請稍後再試。',
  'Notes': '筆記',
  'Flashcards': '溫習卡',
  'Revision notes': '溫習筆記',
  'Print': '列印',
  'Writing notes from your textbook…': '正在根據你的課本編寫筆記…',
  'Written by AI from your textbook. If something looks wrong, check it against the book.': '由 AI 根據你的課本編寫。如發現錯誤，請對照課本。',
  'Practise with flashcards': '用溫習卡練習',
  'Notes are saved on this device, so they open instantly next time.': '筆記會儲存在這部裝置，下次可即時打開。',
  'Make these notes again': '重新編寫筆記',
  'Couldn’t make notes for this chapter. Try again in a moment.': '未能為這一章編寫筆記，請稍後再試。',
  'Making your flashcards': '正在製作溫習卡',
  'Written from your textbook. The first time takes about 20–40 seconds per chapter.': '根據你的課本編寫。首次製作每章約需 20–40 秒。',
  'Couldn’t make flashcards': '未能製作溫習卡',
  'Tap to see the answer': '按一下查看答案',
  'Show answer': '顯示答案',
  'Again': '再來一次',
  'Got it': '記得了',
  'Flashcards · done': '溫習卡 · 完成',
  'known first time': '第一次已記得',
  'You knew every card first time.': '你第一次已記得全部溫習卡。',
  'Shuffle all and go again': '打亂次序再做一次',
  'Practise questions on these chapters': '練習這些章節的題目',
  'Stop flashcards': '停止溫習卡',
  'No weak spots yet': '暫時沒有弱項',
  '12 questions, 20 min': '12 題，20 分鐘',
  'My progress': '我的進度',
  'This week, and a report to send your parents': '今個星期的表現，以及可傳給家長的報告',
  'Prototype. Your textbooks, questions and progress are saved on this device only. Questions are written by AI and checked by AI; tap "Report a problem" if one looks wrong.':
    '試用版。你的課本、題目和進度只儲存在這部裝置。題目由 AI 編寫及檢查；如發現錯誤，請按「報告問題」。',
  'AI usage': 'AI 用量',
  'uploaded': '自行上載',
  // library
  'Textbook library': '課本庫',
  'Book code matched': '課本編號吻合',
  'Add to my textbooks': '加入我的課本',
  'Added · open': '已加入 · 打開',
  'Adding…': '加入中…',
  'Check the book code, or upload your own PDF from the home screen.': '請檢查課本編號，或在主頁上載你自己的 PDF。',
  'Added to your textbooks': '已加入你的課本',
  'The library could not be loaded.': '未能載入課本庫。',
  'Part of this textbook could not be downloaded. Please try again.': '部分課本內容未能下載，請再試。',
  'Could not add this textbook.': '未能加入這本課本。',
  // upload
  'Reading your book': '正在讀取你的課本',
  'Opening the file…': '正在打開檔案…',
  'That book couldn\'t be read': '未能讀取這本書',
  'That book couldn’t be read': '未能讀取這本書',
  'Back to home': '返回主頁',
  'No chapters with enough text were found in this PDF.': '這個 PDF 內找不到有足夠文字的章節。',
  'This file is over 300 MB. Try a smaller PDF or one chapter at a time.': '檔案超過 300 MB。請試較細的 PDF，或每次上載一章。',
  'This PDF has almost no text. It may be scanned pages (pictures of text), which PrepBuddy cannot read yet.':
    '這個 PDF 幾乎沒有文字，可能是掃描頁（文字的圖片），PrepBuddy 暫時未能讀取。',
  // book screen
  '1. Choose chapters': '1. 選擇章節',
  'Select all': '全選',
  'Clear all': '全部取消',
  'New questions will be made': '會編寫新題目',
  'Remove from my textbooks': '從我的課本移除',
  '2. Set up your practice': '2. 設定練習',
  'Questions': '題型',
  'How many': '題數',
  'MCQ': '選擇題',
  'Written': '文字題',
  'Both': '兩者都要',
  'Tick at least one chapter above': '請在上面剔選最少一個章節',
  'Or make a DSE-style mock paper / worksheet': '或製作 DSE 模式模擬試卷／工作紙',
  'Fewer questions': '減少題目',
  'More questions': '增加題目',
  'Back to chapters': '返回章節',
  // remove
  'Remove this textbook?': '移除這本課本？',
  'This deletes from this device:': '以下內容會從這部裝置刪除：',
  'Remove and delete my progress': '移除並刪除我的進度',
  'Keep this textbook': '保留這本課本',
  'Textbook and its progress removed': '已移除課本及其進度',
  'You can add the book again from the library, but your progress will start from zero.': '你可以從課本庫再次加入，但進度會由零開始。',
  'To use it again you will need to upload the PDF again.': '如要再用，需要重新上載 PDF。',
  // practice
  'End session': '結束練習',
  'Recall': '記憶',
  'Understand': '理解',
  'Apply': '應用',
  'Analyse / evaluate': '分析／評鑑',
  'Correct': '答對了',
  'Report a problem': '報告問題',
  'Next question': '下一題',
  'See results': '查看結果',
  'Finish and review': '完成並檢討',
  'Mark my answer': '批改我的答案',
  'Show the answer without trying': '不作答，直接看答案',
  'Type, or tap the microphone on your keyboard to speak': '打字，或按鍵盤上的咪高峰用語音輸入（可以講廣東話）',
  'Aim for one clear point per mark.': '每一分寫一個清楚的要點。',
  'No answer written': '未有作答',
  'No answer written.': '未有作答。',
  'Marking your answer…': '正在批改你的答案…',
  'Checking it against the mark scheme, point by point.': '正逐點對照評分準則。',
  'Mark scheme (ticked = points you earned):': '評分準則（已剔＝你取得的分數）：',
  'Mark scheme:': '評分準則：',
  'Marked by AI. Think it got one wrong? Tap a point to change it.': '由 AI 批改。覺得批錯？按一下該要點修改。',
  'Tip:': '提示：',
  'Thanks. This question is flagged for checking.': '多謝。這題已標記待檢查。',
  'Tap × again to stop and see your results': '再按一次 × 停止並查看結果',
  'Review': '檢討',
  'Time to review. Tick the points you made in written answers.': '開始檢討。文字題會由 AI 批改。',
  'The AI marker is not available right now.': 'AI 批改暫時未能使用。',
  'You seem to be offline, so the AI could not mark this.': '你似乎未連接網絡，AI 未能批改。',
  'Tick the points you made instead.': '請自行剔選你寫到的要點。',
  'Time\'s up': '時間到',
  "Time's up": '時間到',
  // waiting
  'Writing your questions': '正在編寫你的題目',
  'Preparing the next question': '正在準備下一題',
  'Couldn’t make questions': '未能編寫題目',
  'No more questions right now': '暫時沒有更多題目',
  'Try again': '再試一次',
  'See my results': '查看我的結果',
  'Back': '返回',
  'Try this chapter again in a moment.': '請稍後再試這一章。',
  'New questions on the ideas you missed': '針對你答錯的概念的新題目',
  'Each question is written from your textbook, then checked by a second AI. The first ones take 30–60 seconds; after that the next set is made while you practise.':
    '每條題目都根據你的課本編寫，再由另一個 AI 檢查。首批需時 30–60 秒，之後會在你練習時準備下一批。',
  'No internet connection. Questions need a connection to be made.': '沒有網絡連線。編寫題目需要上網。',
  'You seem to be offline.': '你似乎未連接網絡。',
  'This chapter’s text is missing on this device. Try uploading the book again.': '這部裝置上找不到這一章的內容，請重新上載課本。',
  'This chapter’s text is missing on this device.': '這部裝置上找不到這一章的內容。',
  'No questions could be made from this chapter. It may not have enough teaching content.': '未能為這一章編寫題目，可能內容不足。',
  'Something went wrong.': '出現問題。',
  'Couldn’t make drill questions this time. Try again.': '這次未能編寫操練題目，請再試。',
  // access code
  'Enter your access code': '輸入使用碼',
  'PrepBuddy is in testing. You need a code to make new questions. Ask the person who invited you.': 'PrepBuddy 正在試用階段，編寫新題目需要使用碼。請向邀請你的人索取。',
  'Access code': '使用碼',
  'Continue': '繼續',
  // summary
  'Excellent work': '非常好',
  'Good, solid work': '做得不錯',
  'Getting there': '漸入佳境',
  'Worth another go': '值得再試一次',
  'Redo this set (shuffled)': '重做這一組（次序打亂）',
  'Weak-spot drill': '弱項操練',
  'Questions you got right come back later and later. The ones you missed come back tomorrow.': '答對的題目會相隔愈來愈久才再出現；答錯的明天會再出現。',
  'Nothing to review today.': '今日沒有需要溫習的題目。',
  'Practise a chapter first, then come back here.': '請先練習一個章節，再回來這裏。',
  'Answer a few questions first, so PrepBuddy knows your weak spots.': '請先答幾條題目，PrepBuddy 才知道你的弱項。',
  // papers
  'Mock paper or worksheet': '模擬試卷或工作紙',
  'A DSE-style paper:': 'DSE 模式試卷：',
  'Section A': '甲部',
  'Section B': '乙部',
  'multiple choice, then': '多項選擇題，然後',
  'written questions. Sit it timed here and get it marked, or print it with an answer key.': '文字題。可在這裏限時應考並獲批改，或連答案列印出來。',
  'Chapters': '章節',
  'Change chapters': '更改章節',
  'Length': '長度',
  'Short': '短卷',
  'Half paper': '半份試卷',
  'Full paper': '整份試卷',
  'Section A · MCQ': '甲部 · 多項選擇題',
  'Section B · Written': '乙部 · 文字題',
  'Section B · written': '乙部 · 文字題',
  'Time allowed:': '作答時間：',
  'Fewer MCQs': '減少多項選擇題',
  'More MCQs': '增加多項選擇題',
  'Fewer written questions': '減少文字題',
  'More written questions': '增加文字題',
  'Print worksheet with answer key': '列印工作紙（附答案）',
  'Print as a worksheet': '列印為工作紙',
  'written questions. Sit it timed here and get it marked, or print it and enter your answers in the app afterwards to get them marked.': '文字題。可在這裏限時應考並獲批改，或列印出來，完成後在應用程式輸入答案以獲批改。',
  'Name on every page': '每頁顯示的名字',
  'Add your name first. It is printed on every page.': '請先輸入名字，名字會印在每一頁。',
  'There is no answer key on the paper. When you finish, open PrepBuddy, tap': '試卷不附答案。完成後打開 PrepBuddy，按',
  'Mark a printed worksheet': '批改已列印的工作紙',
  'and enter your answers to get them marked.': '並輸入答案以獲批改。',
  'Enter the answers you wrote on paper': '輸入你在紙上寫的答案',
  'Printed worksheets': '已列印的工作紙',
  'Pick the worksheet you did. Check the code at the bottom of the page. Enter what you wrote on paper, and PrepBuddy marks it.': '選擇你做過的工作紙（編號印在每頁底部），輸入你在紙上寫的答案，PrepBuddy 會為你批改。',
  'No printed worksheets yet. Open a textbook, choose Mock paper, then Print as a worksheet.': '仲未有列印過的工作紙。打開課本，選擇模擬試卷，再按「列印為工作紙」。',
  'Enter answers': '輸入答案',
  'Mark again': '再批改一次',
  'Print again': '再列印',
  'Practise from your own textbook: prepbuddy.givingtree.sg': '用你自己的課本練習：prepbuddy.givingtree.sg',
  'Preparing your paper': '正在準備你的試卷',
  'Checking which questions are ready…': '正在檢查已有的題目…',
  'Cancel': '取消',
  'DSE-style mock paper': 'DSE 模式模擬試卷',
  'Section B: written questions': '乙部：文字題',
  'No questions could be made for these chapters.': '未能為這些章節編寫題目。',
  'Could not prepare the paper.': '未能準備試卷。',
  'Worksheet ready': '工作紙已準備好',
  'Print or save as PDF': '列印或儲存為 PDF',
  'On a phone: tap the button, then choose': '用手機：按上面的按鈕，然後選擇',
  'Save as PDF': '儲存為 PDF',
  'or share the PDF. The answer key starts on a new page.': '或分享 PDF。答案由新一頁開始。',
  'Section A · Multiple choice': '甲部 · 多項選擇題',
  'Section B · Written': '乙部 · 文字題',
  'Choose the best answer for each question.': '每題選出最適當的答案。',
  'Answer all questions in the spaces provided.': '在空位作答所有題目。',
  'Answer key': '答案',
  'Name:': '姓名：',
  'Class:': '班別：',
  'All chapters': '所有章節',
  '1 mark': '1 分',
  // progress / report screen
  'Last 7 days': '過去 7 日',
  'questions': '題目',
  'practising': '練習時間',
  'correct': '正確',
  'Your report for parents': '給家長的報告',
  'A one-page summary of this week: practice, scores by chapter, what is improving and what needs work.': '一頁摘要：本週練習、各章分數、進步之處和需要加強的地方。',
  'Your name on the report': '報告上的名字',
  'e.g. Ka Yan': '例如：嘉欣',
  'Preview the report': '預覽報告',
  'Send report to parent': '傳送報告給家長',
  'Opens WhatsApp or another app with a link. Your parent doesn\'t need to sign in.': '會用 WhatsApp 或其他應用程式傳送連結，家長不需登入。',
  'Send the report': '傳送報告',
  'Send on WhatsApp': '用 WhatsApp 傳送',
  'Copy the link': '複製連結',
  'Link copied': '已複製連結',
  'Copy this link:': '複製這個連結：',
  // misc
  'Back to chapters ': '返回章節',
};

// Text with numbers or names in it.
const PATTERNS = [
  [/^(.*?)(\d+) chapters · (\d+) questions( · uploaded)?$/, (m, pre, c, q, up) => `${pre}${c} 個章節 · ${q} 條題目${up ? ' · 自行上載' : ''}`],
  [/^(?:pp\. (\d+)–(\d+) · )?(?:(\d+) ready · (\d+) done|(New questions will be made))( · harder questions now| · more basics first)?$/, (m, a, b, r, d, nw, sh) =>
    `${a ? `第 ${a}–${b} 頁 · ` : ''}${nw ? '會編寫新題目' : `${r} 條可用 · 已做 ${d} 條`}${sh ? (sh.includes('harder') ? ' · 現在題目較深' : ' · 先做基礎題') : ''}`],
  [/^Start (\d+) questions · about (\d+) min$/, '開始 $1 題 · 約 $2 分鐘'],
  [/^Start mock paper · (\d+) min$/, '開始模擬試卷 · $1 分鐘'],
  [/^Level (\d) · (Recall|Understand|Apply|Analyse \/ evaluate)$/, (m, n, l) => `程度 ${n} · ${EXACT[l]}`],
  [/^(MCQ|Graph MCQ|Short answer|Structured|Writing) · (\d+) marks?$/, (m, t, n) => `${{ MCQ: '多項選擇題', 'Graph MCQ': '圖表選擇題', 'Short answer': '短答題', Structured: '結構題', Writing: '寫作' }[t]} · ${n} 分`],
  [/^(\d+) marks?$/, '$1 分'],
  [/^Not quite\. The answer is ([A-D])\.$/, '不太對。答案是 $1。'],
  [/^No answer\. The answer is ([A-D])\.$/, '未有作答。答案是 $1。'],
  [/^(\d+) \/ (\d+) marks$/, '$1 / $2 分'],
  [/^Tick each point your answer makes(?: \(max (\d+)\))?:$/, (m, n) => `剔選你答案寫到的要點${n ? `（最多 ${n} 分）` : ''}：`],
  [/^Retry the (\d+) I missed$/, '重做答錯的 $1 題'],
  [/^(\d+) more on (this chapter|these chapters)$/, (m, n, w) => `${w === 'this chapter' ? '這一章' : '這些章節'}再多 ${n} 題`],
  [/^Drill my weak spots · (\d+) new questions$/, '操練我的弱項 · $1 條新題目'],
  [/^(.+) · done$/, '$1 · 完成'],
  [/^(.+) · stopped after (\d+)$/, '$1 · 做了 $2 題後停止'],
  [/^(Excellent work|Good, solid work|Getting there|Worth another go) · (\d+)%$/, (m, w, p) => `${EXACT[w]} · ${p}%`],
  [/^(\d+) questions? due today · about (\d+) min$/, '今日有 $1 題要溫習 · 約 $2 分鐘'],
  [/^All caught up\. Next review (tomorrow|in (\d+) days|in about a week|in (\d+) weeks)\.$/, (m, w, d, wk) =>
    `全部溫習完畢。下次溫習：${w === 'tomorrow' ? '明天' : d ? `${d} 日後` : wk ? `${wk} 星期後` : '約一星期後'}。`],
  [/^(\d+) of 7 days practised$/, '7 日中有 $1 日練習'],
  [/^↑ (\d+) from last week$/, '比上週 ↑ $1'],
  [/^↓ (\d+) from last week$/, '比上週 ↓ $1'],
  [/^All (\d+) chapters$/, '全部 $1 個章節'],
  [/^(\d+) MCQ · (\d+) written · (\d+) min$/, '$1 題選擇 · $2 題文字 · $3 分鐘'],
  [/^(\d+) min$/, '$1 分鐘'],
  [/^(\d+)h (\d+)m$/, '$1 小時 $2 分'],
  [/^(?:Section A: (\d+) multiple choice · )?(?:Section B: (\d+) written · )?Time: (\d+) min · Total: (\d+) marks$/, (m, a, b, t, tot) =>
    `${a ? `甲部：${a} 題多項選擇題 · ` : ''}${b ? `乙部：${b} 題文字題 · ` : ''}時間：${t} 分鐘 · 總分：${tot} 分`],
  [/^Score:\s*\/ (\d+)$/, '分數：　　／ $1'],
  [/^Section A: (\d+) multiple-choice questions$/, '甲部：$1 題多項選擇題'],
  [/^Only (\d+) questions could be prepared for these chapters\.$/, '這些章節只能準備 $1 條題目。'],
  [/^(\d+) of (\d+) questions ready\. New ones are written from your textbook and checked first, so a long paper can take a few minutes the first time\.$/,
    '已準備 $1 / $2 題。新題目會根據你的課本編寫並先經檢查，所以首次製作長試卷可能需時數分鐘。'],
  [/^From the PrepBuddy library · book code (.+)$/, '來自 PrepBuddy 課本庫 · 課本編號 $1'],
  [/^Made with PrepBuddy from (.+?)\.(.*) Questions are written and checked by AI\.$/, '由 PrepBuddy 根據《$1》製作。$2 題目由 AI 編寫及檢查。'],
  [/^Worksheet (PB-[A-Z0-9]{4})$/, '工作紙 $1'],
  [/^Worksheet:$/, '工作紙編號：'],
  [/^Made for (.+) · (PB-[A-Z0-9]{4})$/, '$1 專用 · $2'],
  [/^Made for$/, ''],
  [/^Get marked: open PrepBuddy › Mark a printed worksheet › (PB-[A-Z0-9]{4})$/, '批改：打開 PrepBuddy › 批改已列印的工作紙 › $1'],
  [/^· (\d+) questions( · Marked: .+)?$/, (m, n, mk) => `· ${n} 條題目${mk ? ' · 已批改：' + mk.replace(' · Marked: ', '') : ''}`],
  [/^Source: (.+)$/, '來源：$1'],
  [/^Uploaded by you · (\d+) pages · chapters found from (.+)$/, (m, n, how) =>
    `自行上載 · ${n} 頁 · 章節來自${how.startsWith('the book') ? '課本書籤' : how.startsWith('numbered') ? '編號標題' : '每 8 頁一節（找不到標題）'}`],
  [/^(\d+) practice questions?$/, '$1 條練習題目'],
  [/^your scores on (\d+) questions?, and their spaced-review schedule$/, '你在 $1 條題目的分數及其間隔溫習時間表'],
  [/^(\d+) answers? in your progress history \(used for parent reports\)$/, '進度紀錄中的 $1 個作答（用於家長報告）'],
  [/^This can't be undone\. (.*)$/, (m, rest) => `此操作無法復原。${EXACT[rest] || rest}`],
  [/^(\d+) chapters · (?:(\d+) questions ready · )?code$/, (m, c, q) => `${c} 個章節 · ${q ? `${q} 條題目已準備 · ` : ''}編號`],
  [/^No textbook matches “(.*)”\.$/, '找不到符合「$1」的課本。'],
  [/^Added (\d+) chapters$/, '已加入 $1 個章節'],
  [/^Page (\d+) of (\d+)$/, '第 $1 / $2 頁'],
  [/^Found (\d+) chapters\. Saving…$/, '找到 $1 個章節，正在儲存…'],
  [/^(\d+) questions to work on$/, '$1 題需要加強'],
  [/^Weak topics · (.+)$/, '弱項 · $1'],
  [/^Part (\d+)$/, '第 $1 部分'],
  [/^(\d+) cards? needed another go\. Going through them again helps them stick\.$/, '有 $1 張需要再溫習。再做一次會記得更牢。'],
  [/^Go through the (\d+) I missed$/, '再溫習未記得的 $1 張'],
  [/^Saving diagrams (\d+) of (\d+)$/, '正在儲存圖表 $1 / $2'],
  [/^To get right \((\d+)\)$/, '待答對（$1）'],
  [/^Mastered \((\d+)\)$/, '已掌握（$1）'],
  [/^Redo these (\d+)$/, '重做這 $1 題'],
  [/^Redo all (\d+)$/, '重做全部 $1 題'],
  [/^(\d+) questions? to get right$/, '$1 題待答對'],
  [/^(\d+) words$/, '$1 字'],
  [/^Marked on (.+)\.$/, '評分範疇：$1。'],
  [/^Hidden \((\d+)\)$/, '已隱藏（$1）'],
  [/^Uploaded by you · (\d+) pages · chapters found from the contents page and headings, checked by AI$/, '自行上載 · $1 頁 · 章節根據目錄及標題找出，並經 AI 檢查'],
  [/^(\d+) chapters$/, '$1 個章節'],
];

export let LANG = 'en';
const KEY = 'prepbuddy.ui';

export function initLang() {
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  const phoneZh = (navigator.languages || [navigator.language || '']).some((l) => /^zh/i.test(l));
  LANG = saved || (phoneZh ? 'zh' : 'en');
  document.documentElement.lang = LANG === 'zh' ? 'zh-HK' : 'en';
  return LANG;
}

export function setLang(l) {
  LANG = l;
  try { localStorage.setItem(KEY, l); } catch (e) {}
  document.documentElement.lang = l === 'zh' ? 'zh-HK' : 'en';
}

export function tr(text) {
  if (LANG !== 'zh') return null;
  const t = text.trim();
  if (!t || !/[A-Za-z]/.test(t)) return null;
  if (Object.prototype.hasOwnProperty.call(EXACT, t)) return text.replace(t, EXACT[t]);
  for (const [re, rep] of PATTERNS) {
    if (re.test(t)) return text.replace(t, t.replace(re, rep));
  }
  return null;
}

const ATTRS = ['placeholder', 'aria-label', 'title'];
// Book content and questions: never translate.
const RAW = '[data-raw], .point > span:last-child, .marker, .fml, .terms, .stem, p.q, .pstem, .opt, .gcap, .expl, .src, .popts, .ph > span:first-child, .ppart > span:first-child, .pk ul, .pexp, table.data, textarea';
const isRaw = (n) => { const el = n.nodeType === 1 ? n : n.parentElement; return !!(el && el.closest && el.closest(RAW)); };
export function translateTree(root) {
  if (LANG !== 'zh' || !root) return;
  if (root.nodeType === 3) { if (isRaw(root)) return; const x = tr(root.nodeValue); if (x !== null && x !== root.nodeValue) root.nodeValue = x; return; }
  if (root.nodeType !== 1) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) { if (isRaw(n)) continue; const x = tr(n.nodeValue); if (x !== null && x !== n.nodeValue) n.nodeValue = x; }
  const els = [root, ...root.querySelectorAll('[placeholder],[aria-label],[title]')];
  for (const el of els) for (const a of ATTRS) {
    if (!el.hasAttribute || !el.hasAttribute(a) || (a === 'title' && isRaw(el))) continue;
    const x = tr(el.getAttribute(a));
    if (x !== null) el.setAttribute(a, x);
  }
}

// Translate everything already on screen and anything added later.
export function watch(root = document.body) {
  translateTree(root);
  new MutationObserver((muts) => {
    if (LANG !== 'zh') return;
    for (const m of muts) {
      if (m.type === 'characterData') translateTree(m.target);
      m.addedNodes.forEach((n) => translateTree(n));
    }
  }).observe(root, { childList: true, subtree: true, characterData: true });
}
