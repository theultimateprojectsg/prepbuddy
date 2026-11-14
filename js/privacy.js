// PrepBuddy privacy notice (Hong Kong PDPO, Cap. 486; Singapore PDPA for families in Singapore).
// Every statement here matches what the code does: see the PrepBuddy project doc "privacy-audit.md".
// When this changes in a way parents should know about, update UPDATED and bump CONSENT_V in app.js so parents agree again.
export const PRIVACY_UPDATED = { en: '15 November 2026', zh: '2026 年 11 月 15 日' };
export const PRIVACY_EMAIL = 'privacy@prepbuddy.ai';

const E = `<a href="mailto:${PRIVACY_EMAIL}">${PRIVACY_EMAIL}</a>`;
export const PRIVACY = {
  en: {
    title: 'Privacy notice',
    intro: `This notice explains, in plain words, what PrepBuddy collects about your child and your family, where it goes, and how you can see, correct or delete it. If anything is unclear, email us at ${E}.`,
    sections: [
      ['1. Who we are',
        `<p>PrepBuddy is a study app for primary and secondary school students. It helps children practise from their own textbooks, with questions, marking and explanations written by AI. PrepBuddy is responsible for the personal data described here (the "data user" under Hong Kong's Personal Data (Privacy) Ordinance).</p>
         <p>Contact: <b>${E}</b>. We follow Hong Kong's Personal Data (Privacy) Ordinance (Cap. 486). For families in Singapore, we also follow Singapore's Personal Data Protection Act.</p>`],
      ['2. What we collect',
        `<p><b>Kept on your device only</b> (in this browser, separately for each child):</p>
         <ul><li>your child's first name, if you enter one, and their grade profile (grade, pace, school language, explanation language, goals and a short "likes" note)</li>
         <li>the textbooks and worksheets you add, and the questions, lessons and notes made from them</li>
         <li>every answer, mark, mistake and star; homework photos and chats; writing; speaking recordings; dictation lists and results</li>
         <li>school tests and school marks you choose to enter; the parent PIN; your family code; your agreement to this notice</li></ul>
         <p><b>Sent to PrepBuddy</b>, only for families in our pilot with a family code, and only after a parent agrees:</p>
         <ul><li>a short summary from each device: first name (if entered), grade profile, how much your child practised and how many answers were right, which features were used, book titles and progress, school marks and test scores you entered (marks and month only), the weekly progress report, stars, the type of device, whether the app is installed and whether a parent PIN is set (not the PIN itself), and app error messages</li>
         <li>if you give it to us: your name and WhatsApp number, so we can send you a short weekly update with a link to your child's report</li>
         <li>anything you send us in "Tell us what you think" (with your child's first name and family code), and questions you report as wrong (the question, your child's answer and your note; no name or family code)</li>
         <li>how much AI each family uses, so we can keep costs under control</li></ul>
         <p><b>We never ask for</b> your child's full name, school, address, ID number or payment details. Please remind your child not to type personal details into answers or chats.</p>`],
      ['3. Where it is kept',
        `<ul><li>Your child's work stays in this browser on this device. It is not uploaded to us, and other families never see it.</li>
         <li>Pilot summaries and feedback are kept in a private, access-controlled storage area (on GitHub, whose servers are in the United States). Only the PrepBuddy team can see them.</li>
         <li>The app runs on Vercel, whose servers are in the United States. Our code does not keep what passes through it; Vercel keeps short technical logs.</li>
         <li>We do not sell your data, use it for advertising, or share it with anyone except the service providers named in this notice.</li></ul>`],
      ['4. What we send to our AI provider',
        `<p>To write questions, mark answers, explain mistakes and teach lessons, PrepBuddy sends the content it needs to <b>Anthropic</b>, our AI provider, whose servers are outside Hong Kong (mainly in the United States). Depending on what your child is doing, this can include:</p>
         <ul><li>text and pictures from the textbook or worksheet being studied</li>
         <li>your child's answers, essays, handwriting drawn on screen, photos of homework, and photos of marked school papers (used only to read the marks)</li>
         <li>what your child types or says to Buddy (speech is first turned into text by the browser)</li>
         <li>the grade profile, so questions suit your child's age and level, and a progress summary for Buddy's study advice</li></ul>
         <p>We never send your child's name, your family code or a device ID with these requests. Photos can show a name or school, so please crop them if you prefer.</p>
         <p>Under Anthropic's commercial terms, Anthropic may not use this content to train its AI. Anthropic deletes it within 30 days, except where it must keep it longer by law or to investigate misuse of its service.</p>
         <p><b>Other services we use:</b></p>
         <ul><li><b>Microsoft Azure</b> (Hong Kong region) turns text into speech when something is read aloud. It receives the words being read, not who your child is.</li>
         <li><b>Your browser's speech recognition</b> (Google in Chrome and on Android; Apple on iPhone and in Safari) turns your child's speech into text when they talk to Buddy or practise speaking, under that company's own privacy terms.</li>
         <li><b>Google Fonts</b> supplies the app's lettering, so Google sees your device's internet address and browser type.</li>
         <li><b>Vercel</b> (hosting) and <b>GitHub</b> (pilot storage), as above.</li></ul>`],
      ['5. Children',
        `<p>PrepBuddy is made for children, so a parent or guardian must agree to this notice before anything is sent to our AI provider or to us. We collect only what is needed to help your child learn and to see whether PrepBuddy is helping. We don't show advertising, and we don't let other people contact your child through the app.</p>`],
      ['6. Books',
        `<p>Please add only textbooks and worksheets your family owns, for your child's own study. The text stays on your device. Parts of it are sent to Anthropic only to write questions, lessons and notes, and are never stored by us or shared with other families. PrepBuddy's free starter books are written by us.</p>`],
      ['7. How long we keep data, and how to delete it',
        `<ul><li><b>On your device:</b> until you delete it. Settings → <b>Delete everything on this device</b> removes every child's books, work, marks and settings, saved voice clips and the family code. You can also remove one book (on its page) or one child (Settings).</li>
         <li><b>Pilot data with us:</b> email ${E} and we will delete your family's data from our records within 30 days. Earlier copies kept in our storage's version history are permanently erased when we delete the whole pilot store, within 3 months after the pilot ends.</li>
         <li><b>With Anthropic:</b> deleted within 30 days, as explained in section 4.</li></ul>`],
      ['8. Your rights',
        `<p>You can ask to see the personal data we hold about you or your child, ask us to correct it, or withdraw your agreement at any time, by emailing ${E}. We will reply within 30 days. Withdrawing your agreement means we stop receiving your family's data; you can then delete everything on your device as described above.</p>`],
      ['9. Security',
        `<ul><li>Everything travels over encrypted connections (HTTPS).</li>
         <li>Our pilot storage is private and only the PrepBuddy team can open it. AI requests carry no family code or device ID.</li>
         <li>You can set a parent PIN to protect parent screens and settings.</li>
         <li>Anyone who has the link to your child's weekly report can open it, so please share it only with people you trust.</li>
         <li>No system is perfectly secure. If something goes wrong that affects your data, we will tell you.</li></ul>`],
      ['10. Changes to this notice',
        `<p>We will update this notice when PrepBuddy changes how it uses data, and change the date at the top. If a change matters to you, we will tell you in the app and ask you to agree again before anything more is sent.</p>`],
    ],
  },
  zh: {
    title: '私隱聲明',
    intro: `本聲明以淺白文字說明 PrepBuddy 會收集你孩子和家庭的哪些資料、資料去向，以及你可以如何查閱、更正或刪除。如有任何疑問，請電郵 ${E}。`,
    sections: [
      ['1. 我們是誰',
        `<p>PrepBuddy 是一個為中小學生而設的溫習應用程式，讓孩子用自己的課本練習，題目、批改和講解由 AI 撰寫。PrepBuddy 負責處理本聲明所述的個人資料（即香港《個人資料（私隱）條例》下的「資料使用者」）。</p>
         <p>聯絡我們：<b>${E}</b>。我們遵守香港《個人資料（私隱）條例》（第 486 章）；對於新加坡的家庭，我們亦遵守新加坡《個人資料保護法》。</p>`],
      ['2. 我們收集甚麼',
        `<p><b>只保存在你的裝置</b>（在這個瀏覽器內，每名孩子分開保存）：</p>
         <ul><li>孩子的名字（如你有填寫）及學習資料（年級、進度、學校教學語言、講解語言、目標及簡短的「喜好」）</li>
         <li>你加入的課本和工作紙，以及據此製作的題目、課堂和筆記</li>
         <li>每個答案、分數、錯題和星星；功課相片和對話；寫作；說話練習錄音；默書表和成績</li>
         <li>你選擇填寫的學校測驗和學校成績；家長密碼；家庭代碼；你對本聲明的同意紀錄</li></ul>
         <p><b>傳送給 PrepBuddy 的資料</b>（只限持有家庭代碼的試用家庭，並須在家長同意之後）：</p>
         <ul><li>每部裝置的簡短摘要：名字（如有填寫）、學習資料、孩子練習了多少及答對多少、用過哪些功能、書名和進度、你填寫的學校成績和測驗分數（只有分數和月份）、每週進度報告、星星數目、裝置類型、是否已安裝應用程式及是否設有家長密碼（不包括密碼本身），以及程式錯誤訊息</li>
         <li>如你提供：你的名字和 WhatsApp 號碼，讓我們每週傳送簡短進度更新及孩子報告的連結</li>
         <li>你在「告訴我們你的意見」中傳送的內容（連同孩子的名字和家庭代碼），以及你報告有錯的題目（題目、孩子的答案和你的備註，不包括名字或家庭代碼）</li>
         <li>每個家庭使用了多少 AI，以便控制成本</li></ul>
         <p><b>我們不會要求</b>孩子的全名、學校、地址、身份證號碼或付款資料。請提醒孩子不要在答案或對話中輸入個人資料。</p>`],
      ['3. 資料存放在哪裏',
        `<ul><li>孩子的功課留在這部裝置的瀏覽器內，不會上載給我們，其他家庭亦看不到。</li>
         <li>試用摘要和意見存放在一個設有存取限制的私人儲存區（位於 GitHub，伺服器在美國），只有 PrepBuddy 團隊可以查看。</li>
         <li>應用程式在 Vercel 上運作，伺服器位於美國。我們的程式不會保留經過的內容；Vercel 會保留簡短的技術紀錄。</li>
         <li>我們不會出售你的資料，不會用作廣告，亦不會與本聲明所列服務供應商以外的任何人分享。</li></ul>`],
      ['4. 我們傳送給 AI 服務供應商的內容',
        `<p>為了出題、批改、解釋錯處和教授課堂，PrepBuddy 會把所需內容傳送給我們的 AI 服務供應商 <b>Anthropic</b>，其伺服器位於香港以外（主要在美國）。視乎孩子正在做甚麼，內容可包括：</p>
         <ul><li>正在溫習的課本或工作紙的文字和圖片</li>
         <li>孩子的答案、文章、在螢幕上書寫的字跡、功課相片，以及已批改學校試卷的相片（只用來讀取分數）</li>
         <li>孩子向 Buddy 輸入或說出的內容（說話會先由瀏覽器轉為文字）</li>
         <li>學習資料（令題目切合孩子的年齡和程度），以及供 Buddy 提供溫習建議的進度摘要</li></ul>
         <p>這些要求不會附上孩子的名字、你的家庭代碼或裝置編號。相片上可能有名字或學校名稱，如你願意，請先裁剪。</p>
         <p>根據 Anthropic 的商業條款，Anthropic 不得用這些內容訓練其 AI。Anthropic 會在 30 天內刪除這些內容，除非法律要求或為調查濫用其服務而需要保留更久。</p>
         <p><b>我們使用的其他服務：</b></p>
         <ul><li><b>Microsoft Azure</b>（香港區域）在朗讀時把文字轉為語音，只會收到要朗讀的字句，不知道孩子是誰。</li>
         <li><b>瀏覽器的語音識別</b>（Chrome 及 Android 為 Google；iPhone 及 Safari 為 Apple）在孩子與 Buddy 對話或練習說話時把語音轉為文字，受該公司的私隱條款約束。</li>
         <li><b>Google Fonts</b> 提供應用程式的字型，因此 Google 會看到你裝置的網絡地址和瀏覽器類型。</li>
         <li><b>Vercel</b>（網站寄存）及 <b>GitHub</b>（試用資料儲存），如上所述。</li></ul>`],
      ['5. 兒童',
        `<p>PrepBuddy 為兒童而設，因此必須由家長或監護人同意本聲明，才會把任何內容傳送給我們的 AI 服務供應商或我們。我們只收集幫助孩子學習及了解 PrepBuddy 是否有效所需的資料。我們不顯示廣告，亦不會讓其他人透過應用程式聯絡你的孩子。</p>`],
      ['6. 課本',
        `<p>請只加入你家庭擁有的課本和工作紙，供孩子自己溫習。課文留在你的裝置內，只會把部分內容傳送給 Anthropic 以撰寫題目、課堂和筆記，我們不會儲存，亦不會與其他家庭分享。PrepBuddy 的免費入門書由我們自行編寫。</p>`],
      ['7. 資料保留多久，以及如何刪除',
        `<ul><li><b>你的裝置上：</b>保留至你刪除為止。在「設定」→ <b>刪除這部裝置上的所有資料</b>，可刪除所有孩子的課本、功課、成績、設定、已儲存的朗讀聲音和家庭代碼。你亦可以刪除一本書（在該書頁面）或一名孩子（在「設定」）。</li>
         <li><b>我們持有的試用資料：</b>請電郵 ${E}，我們會在 30 天內從紀錄中刪除你家庭的資料。儲存區版本紀錄中的較早副本，會在試用結束後 3 個月內刪除整個試用儲存區時永久刪除。</li>
         <li><b>Anthropic：</b>如第 4 節所述，於 30 天內刪除。</li></ul>`],
      ['8. 你的權利',
        `<p>你可以隨時電郵 ${E}，要求查閱我們持有關於你或孩子的個人資料、要求更正，或撤回同意。我們會在 30 天內回覆。撤回同意後，我們會停止接收你家庭的資料；你亦可按上述方法刪除裝置上的所有資料。</p>`],
      ['9. 保安',
        `<ul><li>所有資料都經加密連線（HTTPS）傳送。</li>
         <li>我們的試用儲存區屬私人性質，只有 PrepBuddy 團隊可以開啟。AI 要求不會附上家庭代碼或裝置編號。</li>
         <li>你可以設定家長密碼，保護家長專用頁面和設定。</li>
         <li>任何人只要有孩子每週報告的連結便可以打開，請只與你信任的人分享。</li>
         <li>沒有系統是絕對安全的。如發生影響你資料的事故，我們會通知你。</li></ul>`],
      ['10. 本聲明的更改',
        `<p>當 PrepBuddy 改變使用資料的方式時，我們會更新本聲明及頂部的日期。如更改與你有關，我們會在應用程式內通知你，並在傳送更多資料前再次請你同意。</p>`],
    ],
  },
};
