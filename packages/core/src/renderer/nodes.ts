import type { OutputNode } from './types';

/**
 * Internal mutable tree node used by the reconciler.
 * After commit, the tree is serialized into immutable OutputNode objects.
 */
export class TNode {
  type: string;
  props: Record<string, any>;
  children: TNode[] = [];
  parent: TNode | null = null;

  constructor(type: string, props: Record<string, any> = {}) {
    this.type = type;
    this.props = props;
  }

  appendChild(child: TNode): void {
    child.parent = this;
    this.children.push(child);
  }

  removeChild(child: TNode): void {
    const idx = this.children.indexOf(child);
    if (idx >= 0) this.children.splice(idx, 1);
    child.parent = null;
  }

  insertBefore(child: TNode, before: TNode): void {
    child.parent = this;
    const idx = this.children.indexOf(before);
    if (idx >= 0) {
      this.children.splice(idx, 0, child);
    } else {
      this.children.push(child);
    }
  }

  /** Deep-serialize into a plain OutputNode tree (for adapter consumption). */
  serialize(): OutputNode {
    return {
      type: this.type,
      props: { ...this.props },
      children: this.children.map((c) => c.serialize()),
    };
  }
}

export class TextNode extends TNode {
  text: string;

  constructor(text: string) {
    super('#text', {});
    this.text = text;
  }

  override serialize(): OutputNode {
    return { type: '#text', props: { value: this.text }, children: [] };
  }
}
