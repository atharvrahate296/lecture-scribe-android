/* ============================================================
   Verbatim — demo corpus
   ------------------------------------------------------------
   A realistic recitation excerpt: Indian-classroom acoustics,
   English/Hindi code-switching, student cross-talk, a stretch
   of unrecoverable audio, and a projector-fan noise band.

   The raw text below is the ONLY thing the prototype's simulated
   ASR ever emits. Timestamps, segment ids, block boundaries and
   confidence-derived flags are all COMPUTED (spec §6: never
   trusted from authored input).
   ============================================================ */
(function (S) {
  'use strict';

  // s = speaker tag, t = utterance, c = ASR confidence,
  // gap = seconds of silence before this line, unrec = unrecoverable audio
  var LINES = [
    { s: 'FAC', t: 'Right, settle down please. Last week we finished contiguous allocation, and I told you it wastes memory because of external fragmentation.', c: 0.94 },
    { s: 'FAC', t: 'Today we fix that properly. The idea is called paging.', c: 0.96 },
    { s: 'FAC', t: 'So the basic move is, we stop pretending memory is one long ribbon. We chop physical memory into fixed size pieces, and each piece is called a frame.', c: 0.93 },
    { s: 'FAC', t: 'And we chop the process address space into pieces of exactly the same size, and those are called pages.', c: 0.95 },
    { s: 'FAC', t: 'Frame and page are the same size. Always. Four kilobytes on most machines, on your phone also four kilobytes.', c: 0.92 },
    { s: 'STU', t: 'Sir why four kilobytes only?', c: 0.79, gap: 1.5 },
    { s: 'FAC', t: 'Good question. It is a tradeoff. Bigger pages mean a smaller page table but more waste inside the last page, internal fragmentation. We will do the arithmetic in a minute.', c: 0.91 },
    { s: 'FAC', t: 'Now, the operating system keeps a page table for every process. The page table maps a page number to a frame number. That is the whole trick.', c: 0.94 },
    { s: 'FAC', t: 'Dekho, the CPU generates a logical address. Hardware splits it into two parts, page number p and offset d.', c: 0.71 },
    { s: 'FAC', t: 'The page number indexes into the page table, you get the frame number, and the offset is carried through unchanged.', c: 0.93 },
    { s: 'FAC', t: 'Offset does not change because the page and the frame are the same size. Samajh gaye? Same size, so the position inside stays the same.', c: 0.58 },
    { s: 'STU', t: 'Sir the page table is also in memory only na?', c: 0.74, gap: 2.0 },
    { s: 'FAC', t: 'Exactly. And that is the problem. If the page table sits in main memory, then every single memory reference now costs you two memory accesses.', c: 0.95 },
    { s: 'FAC', t: 'One to read the page table entry, one to read the actual data. You have doubled your memory latency. That is unacceptable.', c: 0.94 },
    { s: 'FAC', t: 'So the hardware people gave us a cache for translations. It is called the translation lookaside buffer, TLB.', c: 0.9 },
    { s: 'FAC', t: 'The TLB is a small, fully associative cache, typically sixty four to a thousand entries, sitting inside the memory management unit.', c: 0.89 },
    { s: 'FAC', t: 'On every address translation the hardware checks the TLB first. If the page number is there, that is a TLB hit, and you get the frame number in one cycle, essentially free.', c: 0.92 },
    { s: 'FAC', t: 'If it is not there, that is a TLB miss, and now you must walk the page table in memory, and then load that entry into the TLB.', c: 0.93 },
    { s: 'FAC', t: 'Write this down. Effective access time equals hit ratio times memory time, plus one minus hit ratio times two into memory time.', c: 0.88 },
    { s: 'FAC', t: 'If your hit ratio is ninety eight percent and memory is hundred nanoseconds, effective access time is hundred and two nanoseconds. Two percent overhead. That is why paging is practical at all.', c: 0.9 },
    { s: 'STU', t: 'Sir if we context switch then TLB entries of old process will be wrong?', c: 0.69, gap: 2.5 },
    { s: 'FAC', t: 'Very good. Yes. Either you flush the TLB on every context switch, which is expensive, or each entry carries an address space identifier so entries from different processes can coexist.', c: 0.91 },
    { s: 'FAC', t: 'Modern chips do the second one. Your Snapdragon does the second one.', c: 0.87 },

    // --- noisy band: projector fan kicks in -------------------
    { s: 'FAC', t: 'Now let us talk about the part that actually makes virtual memory interesting.', c: 0.86, gap: 3.0 },
    { s: 'FAC', t: 'Suppose the process needs more memory than physically exists. What do we do?', c: 0.62 },
    { s: 'STU', t: 'Swap it out sir', c: 0.51 },
    { s: 'FAC', t: 'Correct, but be careful about when. The scheme we use is called demand paging. We bring a page into memory only when it is actually referenced. Not before.', c: 0.83 },
    { s: 'FAC', t: 'Each page table entry has a valid bit. Valid means the page is present in a frame. Invalid means it is not in memory right now.', c: 0.87 },
    { s: 'FAC', t: 'When the CPU touches an invalid page, the hardware raises a trap. That trap is a page fault.', c: 0.9 },
    { s: 'FAC', t: 'A page fault is not an error. Please remember that. Every process starts with almost all pages invalid, so the first few hundred references are all page faults, and that is completely normal.', c: 0.92 },

    // --- unrecoverable band ----------------------------------
    { s: '', t: '', c: 0.11, unrec: true, gap: 1.0, dur: 68 },

    { s: 'FAC', t: 'So the fault handler finds a free frame, reads the page from the backing store on disk, updates the page table, sets the valid bit, and restarts the instruction that faulted.', c: 0.91, gap: 2.0 },
    { s: 'FAC', t: 'Restarting the instruction is important. The instruction never completed, so we simply run it again, and this time the translation succeeds.', c: 0.93 },
    { s: 'STU', t: 'Sir what if there is no free frame at all?', c: 0.77, gap: 1.8 },
    { s: 'FAC', t: 'Then you have to evict somebody. And choosing whom to evict is called page replacement, and this is where the whole subject gets interesting.', c: 0.94 },
    { s: 'FAC', t: 'The simplest policy is first in first out. Evict the oldest page. It is easy but it is stupid, because the oldest page might be the most heavily used one.', c: 0.93 },
    { s: 'FAC', t: 'The theoretically optimal policy is to evict the page that will not be used for the longest time in the future. That is optimal replacement, and it is impossible to implement because you cannot see the future.', c: 0.92 },
    { s: 'FAC', t: 'We use it only as a benchmark. If your policy gets close to optimal on a trace, your policy is good.', c: 0.9 },
    { s: 'FAC', t: 'The practical approximation is LRU, least recently used. Evict the page that has not been touched for the longest time.', c: 0.94 },
    { s: 'FAC', t: 'LRU works because of locality of reference. Programs touch the same small set of pages again and again over any short window. Loops, arrays, stack frames, all local.', c: 0.93 },
    { s: 'STU', t: 'Sir true LRU means we need timestamp on every access, that is very costly na?', c: 0.72, gap: 2.2 },
    { s: 'FAC', t: 'Bilkul sahi. True LRU needs hardware support on every single memory reference, which nobody is willing to pay for.', c: 0.49 },
    { s: 'FAC', t: 'So we approximate. Each page table entry gets a reference bit, which the hardware sets to one whenever the page is touched.', c: 0.91 },
    { s: 'FAC', t: 'The operating system periodically clears these bits. When it needs a victim it scans for a page whose reference bit is zero, meaning nobody touched it since the last sweep.', c: 0.92 },
    { s: 'FAC', t: 'This scanning policy is called second chance, or the clock algorithm, because you imagine the frames arranged in a circle with a hand sweeping around.', c: 0.9 },
    { s: 'FAC', t: 'If the hand lands on a page with reference bit one, it does not evict it, it just clears the bit and moves on. The page gets a second chance.', c: 0.93 },
    { s: 'FAC', t: 'If it lands on a page with reference bit zero, that page is the victim.', c: 0.94 },
    { s: 'FAC', t: 'One more bit matters. The dirty bit. The dirty bit is set when the page has been written to.', c: 0.9 },
    { s: 'FAC', t: 'If you evict a clean page you can just drop it, because an identical copy already exists on disk. If you evict a dirty page you must write it back first, which costs you a full disk write.', c: 0.92 },
    { s: 'FAC', t: 'So a good replacement policy prefers clean victims over dirty victims. Same reference bit, choose the clean one. Free saving.', c: 0.91 },

    { s: 'FAC', t: 'Now the last big idea for today, and this one shows up in every exam.', c: 0.93, gap: 3.5 },
    { s: 'FAC', t: 'Suppose you over commit. You run so many processes that each one gets very few frames.', c: 0.91 },
    { s: 'FAC', t: 'Every process is now faulting constantly. The CPU spends all its time servicing page faults and doing disk input output, and almost no time running actual instructions.', c: 0.92 },
    { s: 'FAC', t: 'This condition is called thrashing. CPU utilisation collapses.', c: 0.95 },
    { s: 'FAC', t: 'And here is the cruel part. The scheduler sees low CPU utilisation and thinks, oh, the CPU is idle, let me admit more processes. Which makes it worse. It is a feedback loop downward.', c: 0.9 },
    { s: 'STU', t: 'So how do we detect it before it happens sir?', c: 0.8, gap: 1.6 },
    { s: 'FAC', t: 'Denning gave us the answer. It is called the working set model.', c: 0.88 },
    { s: 'FAC', t: 'The working set of a process is the set of pages it has referenced in the most recent delta references. Delta is called the working set window.', c: 0.9 },
    { s: 'FAC', t: 'If the sum of the working set sizes of all processes exceeds the total number of frames available, you are going to thrash. Guaranteed.', c: 0.92 },
    { s: 'FAC', t: 'So the operating system measures the working set, and if the demand exceeds supply it suspends a process entirely, frees all its frames, and runs the rest properly.', c: 0.91 },
    { s: 'FAC', t: 'Better to run four processes fast than eight processes not at all. Yeh point yaad rakhna, exam mein aata hai.', c: 0.44 },
    { s: 'FAC', t: 'An alternative is to control the page fault frequency directly. You set an upper and a lower bound on the fault rate per process.', c: 0.9 },
    { s: 'FAC', t: 'Above the upper bound, give that process more frames. Below the lower bound, take frames away. It is a simple controller and it works surprisingly well.', c: 0.91 },
    { s: 'STU', t: 'Sir on mobile phones is it the same thing?', c: 0.76, gap: 2.0 },
    { s: 'FAC', t: 'Mostly, with one difference. Phones usually do not swap to flash storage because writes wear out the flash. Instead the system compresses cold pages in memory, and if that is not enough it kills the background app outright.', c: 0.86 },
    { s: 'FAC', t: 'That is why your app loses state when you come back to it after some time. It was not swapped, it was killed.', c: 0.89 },
    { s: 'FAC', t: 'Okay. For next class, read chapter nine, sections one to six, and try the exercise on effective access time.', c: 0.92, gap: 2.5 },
    { s: 'FAC', t: 'We will do inverted structures and shared memory next week. That is all for today.', c: 0.9 }
  ];

  /* --------------------------------------------------------
     LLM candidate outputs.
     These are the RAW proposals from the summarisation and
     glossary adapters, BEFORE the grounding filter runs.
     Deliberately includes ungrounded candidates so the filter
     has something real to reject (spec §11).
     -------------------------------------------------------- */

  var POINT_CANDIDATES = [
    { topic: 'Paging basics',
      point: 'Physical memory is divided into fixed-size frames and process address space into equal-sized pages, which removes external fragmentation.',
      claim: [2, 3, 4] },
    { topic: 'Address translation',
      point: 'A logical address splits into a page number and an offset; the page number indexes the page table to get a frame number while the offset passes through unchanged.',
      claim: [8, 9, 10] },
    { topic: 'Translation cost',
      point: 'Keeping the page table in main memory would double memory latency, since each reference needs one access for the page table entry and one for the data.',
      claim: [12, 13] },
    { topic: 'TLB',
      point: 'The TLB caches recent translations inside the MMU; a hit resolves in about one cycle and a TLB miss forces a page table walk.',
      claim: [14, 15, 16, 17] },
    { topic: 'TLB',
      point: 'Effective access time is hit ratio times memory time plus one minus hit ratio times twice memory time; at a 98 percent hit ratio and 100 ns memory this gives 102 ns.',
      claim: [18, 19] },
    { topic: 'Context switching',
      point: 'TLB entries must either be flushed on a context switch or tagged with an address space identifier so entries from different processes can coexist.',
      claim: [20, 21, 22] },
    { topic: 'Demand paging',
      point: 'Demand paging loads a page only on first reference; the valid bit marks presence and touching an invalid page raises a page fault, which is normal rather than an error.',
      claim: [26, 27, 28, 29] },
    { topic: 'Fault handling',
      point: 'The fault handler finds a free frame, reads the page from backing store, updates the page table and restarts the faulting instruction.',
      claim: [31, 32] },
    { topic: 'Replacement',
      point: 'FIFO evicts the oldest page and can evict a hot one; optimal replacement is only a benchmark since it needs future knowledge; LRU is the practical approximation and works because of locality of reference.',
      claim: [35, 36, 37, 38, 39] },
    { topic: 'Replacement',
      point: 'True LRU is too costly, so a reference bit plus the second chance or clock sweep approximates it, and the dirty bit makes clean pages cheaper victims than dirty ones.',
      claim: [41, 42, 43, 44, 46, 47, 48] },
    { topic: 'Thrashing',
      point: 'Over-committing frames causes thrashing, where CPU utilisation collapses and the scheduler worsens it by admitting still more processes.',
      claim: [51, 52, 53] },
    { topic: 'Working set',
      point: 'The working set model sizes each process by the pages touched in the last delta references; if the total working set exceeds available frames the system suspends a process instead of thrashing.',
      claim: [55, 56, 57, 58] },
    { topic: 'Mobile behaviour',
      point: 'Phones avoid swapping to flash because of write wear, compressing cold pages instead and killing background apps when that is not enough.',
      claim: [63, 64] },

    /* --- ungrounded candidates: the filter must reject these --- */
    { topic: 'Replacement',
      point: 'The lecture proved that FIFO suffers from Belady’s anomaly, where adding more frames increases the number of page faults.',
      claim: [35, 36] },
    { topic: 'Page tables',
      point: 'Inverted page tables were recommended as the default structure for 64-bit systems because they scale with physical rather than virtual memory.',
      claim: [7, 8] },
    { topic: 'Fault handling',
      point: 'Copy-on-write was described as the mechanism that makes process forking cheap on this hardware.',
      claim: [31, 999] }
  ];

  var TERM_CANDIDATES = [
    { term: 'frame', def: 'A fixed-size block of physical memory. Every frame is the same size as a page, which is what lets the offset pass through translation unchanged.' },
    { term: 'page table', def: 'The per-process structure mapping page numbers to frame numbers. It lives in main memory, which is why translation needs caching.' },
    { term: 'TLB', def: 'Translation lookaside buffer: a small fully associative cache of recent page-to-frame translations, held inside the MMU.' },
    { term: 'TLB miss', def: 'A translation not found in the TLB, forcing a page table walk in main memory before the entry is cached.' },
    { term: 'demand paging', def: 'Bringing a page into memory only when it is first referenced, rather than loading the whole address space up front.' },
    { term: 'valid bit', def: 'The page table entry bit recording whether a page is currently present in a frame. Touching an invalid page traps.' },
    { term: 'page fault', def: 'The trap raised when a process references a page not currently in memory. Normal during process start-up, not an error condition.' },
    { term: 'page replacement', def: 'Choosing which resident page to evict when a fault arrives and no free frame exists.' },
    { term: 'LRU', def: 'Least recently used: evict the page untouched for the longest time. Effective because programs show locality of reference.' },
    { term: 'locality of reference', def: 'The tendency of a program to repeatedly touch a small set of pages within any short window of execution.' },
    { term: 'second chance', def: 'A clock sweep over frames that clears a set reference bit and moves on, evicting only pages whose reference bit is already zero.' },
    { term: 'dirty bit', def: 'Set when a page has been written to. A dirty victim must be written back to disk; a clean victim can simply be dropped.' },
    { term: 'thrashing', def: 'The state where processes fault so constantly that the CPU does almost no useful work, and the scheduler makes it worse by admitting more processes.' },
    { term: 'working set', def: 'The set of pages a process referenced in the most recent delta references. Comparing the total working set against available frames predicts thrashing.' },

    /* --- ungrounded candidates: the filter must reject these --- */
    { term: 'Belady’s anomaly', def: 'The counter-intuitive case where increasing the frame count raises the fault count under FIFO.' },
    { term: 'copy-on-write', def: 'Deferring the duplication of a page until one of the sharers writes to it.' },
    { term: 'inverted page table', def: 'A single system-wide table with one entry per physical frame rather than per virtual page.' }
  ];

  S.corpus = {
    course: 'CS3006 · Operating Systems',
    title: 'Lecture 14 — Virtual Memory: Paging, the TLB & Thrashing',
    room: 'Block B, Hall 204 · recitation excerpt',
    lines: LINES,
    pointCandidates: POINT_CANDIDATES,
    termCandidates: TERM_CANDIDATES
  };
})(window.Verbatim = window.Verbatim || {});
