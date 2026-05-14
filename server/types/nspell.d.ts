declare module "nspell" {
  type Dictionary = {
    aff: Buffer | string;
    dic?: Buffer | string;
  };

  type NSpell = {
    correct(word: string): boolean;
    suggest(word: string): string[];
    add(word: string, model?: string): NSpell;
  };

  export default function nspell(dictionary: Dictionary): NSpell;
}
