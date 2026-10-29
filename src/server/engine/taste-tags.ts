import type { TagRef } from "@/shared/contracts";
import type { QlooRecord } from "@/server/qloo/client";

const generic = new Set(["restaurant", "restaurants", "bar", "bars", "cafe", "café", "coffee", "coffee shop", "tourist attraction", "hotel", "hotels", "museum", "shopping", "shopping mall", "park"]);
const nationalities = new Set((
  "european|american|italian|french|mediterranean|british|asian|portuguese|german|spanish|mexican|african|north african|south african|east african|west african|middle eastern|latin american|south american|north american|central american|caribbean|scandinavian|nordic|eastern european|western european|southeast asian|south asian|east asian|central asian|" +
  "afghan|albanian|algerian|andorran|angolan|argentine|argentinian|armenian|australian|austrian|azerbaijani|bahamian|bahraini|bangladeshi|barbadian|basque|belarusian|belgian|belizean|beninese|bhutanese|bolivian|bosnian|botswanan|brazilian|bruneian|bulgarian|burkinabe|burmese|burundian|cambodian|cameroonian|canadian|cape verdean|catalan|chadian|chilean|chinese|colombian|comorian|congolese|costa rican|croatian|cuban|cypriot|czech|danish|dominican|dutch|ecuadorian|egyptian|emirati|english|equatorial guinean|eritrean|estonian|ethiopian|fijian|filipino|finnish|gabonese|gambian|georgian|ghanaian|greek|grenadian|guatemalan|guinean|guyanese|haitian|hawaiian|honduran|hungarian|icelandic|indian|indonesian|iranian|iraqi|irish|israeli|ivorian|jamaican|japanese|jordanian|kazakh|kenyan|korean|north korean|south korean|kuwaiti|kyrgyz|lao|laotian|latvian|lebanese|lesothan|liberian|libyan|lithuanian|luxembourgish|macedonian|malagasy|malawian|malaysian|maldivian|malian|maltese|mauritanian|mauritian|moldovan|monacan|mongolian|montenegrin|moroccan|mozambican|namibian|nepalese|nepali|new zealand|nicaraguan|nigerien|nigerian|norwegian|omani|pakistani|palestinian|panamanian|papua new guinean|paraguayan|persian|peruvian|polish|puerto rican|qatari|romanian|russian|rwandan|salvadoran|samoan|saudi|saudi arabian|scottish|senegalese|serbian|seychellois|sierra leonean|singaporean|slovak|slovenian|somali|sri lankan|sudanese|surinamese|swedish|swiss|syrian|taiwanese|tajik|tanzanian|thai|tibetan|togolese|tongan|trinidadian|tunisian|turkish|turkmen|ugandan|ukrainian|uruguayan|uzbek|venezuelan|vietnamese|welsh|yemeni|zambian|zimbabwean|" +
  "cantonese|sichuan|szechuan|hunan|shanghainese|tuscan|sicilian|neapolitan|sardinian|bavarian|andalusian|galician|provençal|alsatian|bengali|punjabi|gujarati|south indian|north indian|kerala|cajun|creole|tex mex|southern|soul food"
).split("|"));

export function regionNames(): Set<string> {
  const display = new Intl.DisplayNames(["en"], { type: "region" });
  const names = new Set<string>();
  for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b);
    const name = display.of(code);
    if (name && name !== code) names.add(name.toLowerCase());
  }
  return names;
}

const countries = regionNames();

export function specificPlaceGenre(tag: TagRef, row: QlooRecord = {}): boolean {
  if (!tag.id.startsWith("urn:tag:genre:place:")) return false;
  const name = tag.name.normalize("NFKC").trim().toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ");
  if (generic.has(name) || /cuisine/i.test(`${row.subtype ?? ""} ${row.type ?? ""} ${tag.id}`)) return false;
  const cuisine = name.replace(/^(?:(?:modern|new|traditional|contemporary|authentic|fusion)\s+)+/, "")
    .replace(/\s+(?:restaurants?|cuisine|food|cooking)$/, "");
  return !nationalities.has(cuisine) && !countries.has(cuisine);
}
