import { ExploreState, type Domain } from '../../src/shared/contracts';
import { searchEntities } from '../../src/server/qloo/search';

export const profiles = [
  { name: 'techno', tastes: [['Ben Klock', 'artist'], ['Berghain', 'place'], ['Rick Owens', 'brand']] },
  { name: 'reader', tastes: [['Haruki Murakami', 'author'], ['Radiohead', 'artist'], ['Fleabag', 'tv_show']] },
  { name: 'night owl', tastes: [['Charli xcx', 'artist'], ['Peggy Gou', 'artist'], ['Euphoria', 'tv_show']] },
  { name: 'pop', tastes: [['Taylor Swift', 'artist'], ['Bridgerton', 'tv_show'], ['Starbucks', 'brand']] },
  { name: 'metal sport', tastes: [['Metallica', 'artist'], ['Real Madrid', 'brand']] },
  { name: 'indie outdoors', tastes: [['Radiohead', 'artist'], ['Fleabag', 'tv_show'], ['Wes Anderson', 'person'], ['Patagonia', 'brand']] },
] as const;

export async function profile(city: string, tastes: readonly (readonly [string, string])[]) {
  const loves = await Promise.all(tastes.map(async ([query, domain]) => {
    let candidates = await searchEntities(query, domain as Domain);
    if (!candidates.length) candidates = await searchEntities(query);
    const chosen = candidates.find(e => e.name.toLowerCase() === query.toLowerCase()) ?? candidates[0];
    if (!chosen) throw new Error(`Unresolved reference: ${query}`);
    if (query === 'Euphoria' && chosen.domain !== 'tv_show') throw new Error('Euphoria must resolve as TV');
    return { query, chosen, candidates: candidates.slice(0, 6), weight: 1 };
  }));
  return ExploreState.parse({ city, loves });
}
