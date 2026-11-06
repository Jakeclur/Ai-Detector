# Opus 5.5 sample prompts

Every passage in `tune.txt` and `holdout.txt` is real Claude Opus 5.5 output (model `claude-opus-5-5`), written in a Claude Code session on 6 Nov 2026 in reply to the prompts below. Passages are in the same order as the prompts.

**Caveat:** the model wrote these knowing they were for a detector project, and after reading the detector's clue lists. It tried to answer each prompt the way it normally would, but it may have avoided or overused some habits without meaning to. Treat these as a good first sample, not a perfect one. Real Opus 5.5 answers from claude.ai, collected without that context, would be better.

`refined_tune.txt` (8, from tune passages 2, 5, 7, 8, 11, 13, 16, 19) and `refined_holdout.txt` (7, from hold-out passages 3, 12, 15, 18, 30, 36, 40) are "human-refined" versions: some of the passages above edited the way a student might before handing them in (cutting the chatbot framing, adding personal details, casual words and a few typos, and rewording sentences). These edits were also written by Opus 5.5, simulating a person, so they're only a stand-in for real human editing.

## tune.txt (26)
1. Why is the sky blue?
2. How do vaccines work?
4. How does compound interest work?
5. Explain photosynthesis for a Year 10 student.
7. What's the best way to study for exams?
8. Should I learn Python or JavaScript first?
10. Any tips for my first job interview?
11. Write a paragraph on the causes of World War I.
13. Analyse the theme of courage in To Kill a Mockingbird.
14. Write a reflection on a group project for school.
16. What was the impact of the gold rush on Australia?
17. Write a short story about a lost dog finding its way home.
19. Write a short story about a kid's first day at a new school.
20. Write a short horror story.
22. Write an email to my coach saying I'll miss training this week.
23. Write a thank-you note to my grandma for a birthday present.
25. Write a review of some wireless headphones.
26. Summarise where Australia is at with renewable energy.
28. Write a blog post about a weekend hike.
29. Why does my Python code say "list index out of range"?
31. Describe your ideal weekend (school writing prompt).
32. Write a movie review but make it sound like a teenager wrote it.
34. Write a short post about my trip to the beach for social media.
35. Write a cover letter for a cafe job.
37. Cats or dogs: which makes the better pet?
38. How can I cut down my screen time?

## holdout.txt (14)
3. What causes inflation?
6. What's the difference between weather and climate?
9. How do I deal with a friend who's always late?
12. Write a persuasive essay on school uniforms.
15. Write a short essay on social media and teenagers.
18. Write a sci-fi story about a robot learning to paint.
21. Write an email to my teacher asking for an extension.
24. Write a complaint email about a late delivery.
27. Write a speech for my school captain application.
30. What are the pros and cons of nuclear power?
33. Argue that homework should be banned, written like a teenager.
36. Explain black holes simply.
39. Analyse the poem "Dulce et Decorum Est".
40. Why did the Roman Empire fall?

## Second batch (v10): extra_tune.txt (20) and extra_holdout.txt (10)

Written later in the same session, in reply to the prompts below, to cover the genres where the detector was weakest (stories, news, essays, emails, technical writing). The same caveat applies: the model knew these were for a detector.

extra_tune.txt: 1–5 short stories (an inherited island house, a town power outage, a care robot, a haunted office printer, a letter delivered 40 years late); 6–8 news reports (a Hobart rail-trail decision, a weed that cleans contaminated soil, a Queensland school phone ban); 9–11 essays (ambition in Macbeth, the Depression and the Nazi rise, compulsory voting); 12–15 emails (shift handover to a co-worker, a parent to a teacher, a project update, a faulty-boots complaint); 16 how-to (two-factor authentication); 17 lab report (enzymes and temperature); 18 technical explanation ("works on my machine"); 19 book review; 20 meeting minutes.

extra_holdout.txt: 1–3 short stories (a reopened bakery, a ghost ship at a lighthouse, a grandmother who notices); 4–5 news reports (Melbourne contactless fares, loggerhead turtle nests); 6–7 essays (the Eureka Stockade, social media and young people); 8 email (quitting a basketball team); 9 explanation (mortgage offset accounts); 10 excursion reflection.

Names, places, organisations and figures in these passages are invented for the writing tasks (the news reports are fictional).

## Third batch (v11): batch3_tune.txt (25) and batch3_holdout.txt (15)

Same session, same caveat. batch3_tune.txt: 1–5 short stories (a boy who carries his sister's ukulele, a forbidden jetty, a retired nurse, a 3am message from a runaway brother, a strict piano teacher); 6–8 news reports (unit pricing rules, a school solar battery, whales off Sydney); 9–11 essays (Industrial Revolution living standards, Boxer in Animal Farm, a republic); 12–15 messages (a casual weekend plan, an apology to a teacher, a sports club notice, a road-safety letter to a councillor); 16 explanation (inflation and the RBA); 17 how-to (topic sentences); 18 excursion report; 19 graduation speech; 20 game review; 21 casual post about rowing; 22 explanation (leap years); 23 pros and cons (four-day school week); 24 work-experience reflection; 25 group project meeting notes.

batch3_holdout.txt: 1–3 short stories (snow and a grandfather's hat, a letter from your 8-year-old self, a night in hospital); 4–5 news reports (Gold Coast light rail, a new Kimberley gecko); 6–7 essays (Romeo and Juliet, primary school homework); 8 casual email declining a party; 9 explanation (herd immunity); 10 drama reflection; 11 explanation (why the sea is salty); 12 casual post about a group project; 13 parent email to a teacher; 14 explanation (thunderstorms); 15 book review (Holes).

Names, figures and news events in these passages are invented for the writing tasks.
