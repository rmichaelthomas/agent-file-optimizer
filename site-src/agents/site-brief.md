# Site brief

**Purpose.** Let a person who has never seen the project say, in under a minute, what it does, what it will not do, and what it costs them. It is not a sales page. There is no hosted service, no price, and no sign-up, and the page must never imply one.

**Audience.** Someone who wants to hand a folder of mixed files to an AI agent or a colleague for a few hours. They may be technical, but the page never assumes it. One audience, one view.

**Idea.** The page is organised around the life of a link: handed over, read, gone. It shows rather than describes: the three windows are drawn to scale; the files an agent receives are real output, printed by the product's own code (`site-src/tools/capture-samples.mjs`); where it stops is as prominent as what works.

**Voice.** Plain, scoped, short. No "blazing", "revolutionary", "effortless". Never "any file", never "malware scanned", never a claim of zero retention (the privacy notes call it a design goal, not a guarantee). Never say it is generally faster than, or replaces, anything.

**Failures even if everything works (anti-goals).**
- A figure that sounds broader than its report: a general "saves N% of tokens" claim, or a number without its conditions.
- Hiding the result that does not flatter the product. The "no saving on plain text and code" receipt sits beside the 91% receipt at equal size, on purpose.
- Implying a hosted service, a free tier, or user counts.
- A section about AllHereHTML, or any coverage display of instruments.
- Anything that needs script to make sense, or a control that looks dead without it.

**Design identity.** Warm paper and green, with a rust colour that always means "ended" (the `410`, the end of a window). Light and dark follow the visitor's setting. System fonts. The same look as the earlier page, so it still reads as the same project.

**Claims policy.** Each receipt has five parts: the claim (one sentence), when it holds, what it does not tell you (as large as the claim), how to check it (the report and the command), and how to say it is wrong (the repository's issue form). `checkClaims` fails the tests if a figure, a stated condition or a multi-digit number is not found in the cited report.

**Contact.** The repository's issue form. There is no private address on the page.

**Credit.** One footer line: "Page made with AllHereHTML." The instruments are authored to the registry contracts and marked with `data-ahi`; nothing is vendored, because this repository is public and AllHereHTML has no licence file or public remote yet.
