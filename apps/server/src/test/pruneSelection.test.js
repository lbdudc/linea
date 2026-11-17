import { describe, expect, it } from 'vitest';
import { pruneSelection } from '../model/services/modules/ModularService.js';

const SELECTION = 'selection of Demo {\n  select Demo\n  select Alpha\n  select Beta\n}\n';

describe('pruneSelection: a selection without the features the SPL no longer has', () => {
  it('drops the selected features that are not in the feature model, and says which', () => {
    const { text, dropped } = pruneSelection({ text: SELECTION, known: new Set(['Demo', 'Beta']) });

    expect(dropped).toEqual(['Alpha']);
    expect(text).toBe('selection of Demo {\n  select Demo\n  select Beta\n}\n');
  });

  it('leaves a selection that fits as it was', () => {
    const { text, dropped } = pruneSelection({ text: SELECTION, known: new Set(['Demo', 'Alpha', 'Beta']) });

    expect(dropped).toEqual([]);
    expect(text).toBe(SELECTION);
  });
});
