import type { Annotation, TextDocument } from './types';

/**
 * 一条全局脚注条目。编号完全由当前稿派生：
 * 章节序 → 句序 → 词在句中的位置（句级注释排在该句最后一个词注之后，
 * 章级注释排在全章最前），同一锚点按注释在文稿中的次序排列。
 */
export interface FootnoteEntry {
  annotation: Annotation;
  /** 全局脚注编号，正文标记、章末注与导出稿共用这一个号 */
  number: number;
  chapterId: string;
  sentenceId: string;
  tokenId: string;
  /** 失去锚点（正文已删改、引用已迁移失败）的注释仍参与编号，避免断链 */
  orphan: boolean;
}

export interface FootnoteIndex {
  /** 按正文出现顺序排列的全部条目，同一条注释只出现一次 */
  entries: FootnoteEntry[];
  numberById: Map<string, number>;
  entryById: Map<string, FootnoteEntry>;
  /** 锚点（章 / 句 / 词 ID）上的条目，已按全局顺序排列 */
  byAnchor: Map<string, FootnoteEntry[]>;
  /** 每章条目，已按全局顺序排列 */
  byChapter: Map<string, FootnoteEntry[]>;
  /** 找不到正文锚点的条目，统一排在全部章节之后 */
  orphanEntries: FootnoteEntry[];
}

interface AnchorPosition {
  chapterOrder: number;
  sentenceOrder: number;
  tokenPos: number;
  docIndex: number;
  chapterId: string;
  sentenceId: string;
  tokenId: string;
  orphan: boolean;
}

const FIRST = Number.MAX_SAFE_INTEGER;

export function buildFootnoteIndex(document: TextDocument): FootnoteIndex {
  const tokenPositions = new Map<
    string,
    { chapterOrder: number; sentenceOrder: number; tokenPos: number; chapterId: string; sentenceId: string }
  >();
  const sentencePositions = new Map<
    string,
    { chapterOrder: number; sentenceOrder: number; tokenCount: number; chapterId: string }
  >();
  const chapterOrders = new Map<string, number>();

  document.chapters.forEach((chapter) => {
    chapterOrders.set(chapter.id, chapter.order);
    chapter.sentences.forEach((sentence) => {
      sentencePositions.set(sentence.id, {
        chapterOrder: chapter.order,
        sentenceOrder: sentence.order,
        tokenCount: sentence.tokens.length,
        chapterId: chapter.id
      });
      sentence.tokens.forEach((token, tokenPos) => {
        tokenPositions.set(token.id, {
          chapterOrder: chapter.order,
          sentenceOrder: sentence.order,
          tokenPos,
          chapterId: chapter.id,
          sentenceId: sentence.id
        });
      });
    });
  });

  const positioned = document.annotations.map((annotation, docIndex): { annotation: Annotation; position: AnchorPosition } => {
    if (annotation.anchorType === 'word') {
      const hit = tokenPositions.get(annotation.anchorId);
      if (hit) {
        return {
          annotation,
          position: {
            ...hit,
            docIndex,
            tokenId: annotation.anchorId,
            orphan: false
          }
        };
      }
    } else if (annotation.anchorType === 'sentence') {
      const hit = sentencePositions.get(annotation.anchorId);
      if (hit) {
        return {
          annotation,
          position: {
            chapterOrder: hit.chapterOrder,
            sentenceOrder: hit.sentenceOrder,
            // 句级标记挂在句末，排在该句全部词注之后
            tokenPos: hit.tokenCount,
            docIndex,
            chapterId: hit.chapterId,
            sentenceId: annotation.anchorId,
            tokenId: '',
            orphan: false
          }
        };
      }
    } else {
      const chapterOrder = chapterOrders.get(annotation.anchorId);
      if (chapterOrder !== undefined) {
        return {
          annotation,
          position: {
            chapterOrder,
            sentenceOrder: 0,
            tokenPos: -1,
            docIndex,
            chapterId: annotation.anchorId,
            sentenceId: '',
            tokenId: '',
            orphan: false
          }
        };
      }
    }

    return {
      annotation,
      position: {
        chapterOrder: FIRST,
        sentenceOrder: FIRST,
        tokenPos: FIRST,
        docIndex,
        chapterId: '',
        sentenceId: '',
        tokenId: '',
        orphan: true
      }
    };
  });

  positioned.sort((a, b) => {
    const p = a.position;
    const q = b.position;
    return (
      p.chapterOrder - q.chapterOrder ||
      p.sentenceOrder - q.sentenceOrder ||
      p.tokenPos - q.tokenPos ||
      p.docIndex - q.docIndex
    );
  });

  const entries: FootnoteEntry[] = positioned.map((item, index) => ({
    annotation: item.annotation,
    number: index + 1,
    chapterId: item.position.chapterId,
    sentenceId: item.position.sentenceId,
    tokenId: item.position.tokenId,
    orphan: item.position.orphan
  }));

  const numberById = new Map<string, number>();
  const entryById = new Map<string, FootnoteEntry>();
  const byAnchor = new Map<string, FootnoteEntry[]>();
  const byChapter = new Map<string, FootnoteEntry[]>();
  const orphanEntries: FootnoteEntry[] = [];

  for (const entry of entries) {
    numberById.set(entry.annotation.id, entry.number);
    entryById.set(entry.annotation.id, entry);

    if (entry.orphan) {
      orphanEntries.push(entry);
      continue;
    }
    byAnchor.set(entry.annotation.anchorId, [...(byAnchor.get(entry.annotation.anchorId) ?? []), entry]);
    byChapter.set(entry.chapterId, [...(byChapter.get(entry.chapterId) ?? []), entry]);
  }

  return { entries, numberById, entryById, byAnchor, byChapter, orphanEntries };
}

/** 统计一条句子锚点（含句内词语）上的注释数，供无障碍标签使用 */
export function countSentenceFootnotes(index: FootnoteIndex, sentence: { id: string; tokens: { id: string }[] }) {
  let count = index.byAnchor.get(sentence.id)?.length ?? 0;
  for (const token of sentence.tokens) count += index.byAnchor.get(token.id)?.length ?? 0;
  return count;
}
