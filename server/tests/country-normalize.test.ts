/**
 * 国家归一表的契约测试
 * ------------------------------------------------------------------
 * 这组断言保护三件事：
 *  1. 同一个国家的各种写法（中英文 / ISO / 口语）都能归一到同一个中文简称；
 *  2. 归一表内部没有冲突（不同国家不会抢同一个匹配键，例如 爱尔兰 vs 冰岛）；
 *  3. 认不出来的写法原样保留，绝不吞掉用户填写的内容。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COUNTRIES,
  COUNTRY_OPTIONS,
  countryAliasList,
  countryFlag,
  formatCountry,
  isKnownCountry,
  normalizeCountry,
  resolveCountry,
} from '../src/utils/country';

test('常见写法都归一到同一个中文简称', () => {
  const cases: [string, string][] = [
    ['UK', '英国'],
    ['U.K.', '英国'],
    ['England', '英国'],
    ['great britain', '英国'],
    ['英国', '英国'],
    ['USA', '美国'],
    ['u.s.a.', '美国'],
    ['United States of America', '美国'],
    ['America', '美国'],
    [' 美国 ', '美国'],
    ['Deutschland', '德国'],
    ['Holland', '荷兰'],
    ['UAE', '阿联酋'],
    ['Viet Nam', '越南'],
    ['korea', '韩国'],
    ['Czech Republic', '捷克'],
    ['香港', '中国香港'],
  ];
  cases.forEach(([input, expected]) => {
    assert.equal(normalizeCountry(input), expected, `归一失败：${input}`);
  });
});

test('归一结果幂等：再归一次不会变', () => {
  COUNTRIES.forEach((entry) => {
    assert.equal(normalizeCountry(entry.name), entry.name);
  });
});

test('认不出来的写法原样保留，空值返回 null', () => {
  assert.equal(normalizeCountry('Atlantis'), 'Atlantis');
  assert.equal(normalizeCountry('某个还没收录的国家'), '某个还没收录的国家');
  assert.equal(normalizeCountry(''), null);
  assert.equal(normalizeCountry('   '), null);
  assert.equal(normalizeCountry(null), null);
  assert.equal(normalizeCountry(undefined), null);
  assert.equal(isKnownCountry('Atlantis'), false);
  assert.equal(isKnownCountry('UK'), true);
});

test('匹配键在国家之间不冲突', () => {
  const seen = new Map<string, string>();
  const key = (value: string) => value.toLowerCase().replace(/[\s\u3000.,;:'"`’‘“”·\-_/\\()（）[\]【】<>{}&+]/g, '');
  COUNTRIES.forEach((entry) => {
    [entry.code, entry.en, entry.name, ...entry.aliases].forEach((candidate) => {
      const k = key(candidate);
      const owner = seen.get(k);
      if (owner && owner !== entry.name) {
        assert.fail(`写法「${candidate}」同时属于 ${owner} 与 ${entry.name}`);
      }
      seen.set(k, entry.name);
    });
  });
});

test('别名表覆盖同一个国家的全部已知写法', () => {
  const aliases = countryAliasList('英国');
  ['英国', 'United Kingdom', 'UK', 'GB', 'England'].forEach((alias) => {
    assert.ok(aliases.includes(alias), `别名缺失：${alias}`);
  });
  // 去重
  assert.equal(new Set(aliases).size, aliases.length);
  // 未知值退化成自身，方便筛选时按字面匹配
  assert.deepEqual(countryAliasList('Atlantis'), ['Atlantis']);
  assert.deepEqual(countryAliasList(''), []);
});

test('展示文案带国旗 emoji，未知值原样显示', () => {
  assert.equal(formatCountry('UK'), '🇬🇧 英国');
  assert.equal(formatCountry('美国'), '🇺🇸 美国');
  assert.equal(formatCountry('Atlantis'), 'Atlantis');
  assert.equal(formatCountry(''), '');
  assert.equal(countryFlag('uk'), '🇬🇧');
  assert.equal(countryFlag('Atlantis'), '');
  assert.equal(countryFlag('CN'), '🇨🇳');
});

test('下拉候选项：值唯一且标签带国旗', () => {
  const values = COUNTRY_OPTIONS.map((option) => option.value);
  assert.equal(new Set(values).size, values.length);
  COUNTRY_OPTIONS.forEach((option) => {
    assert.ok(option.value.length > 0);
    // 标签以「国旗 + 空格」开头：国旗是两个区域指示符（U+1F1E6..U+1F1FF）
    const codePoints = [...option.label.slice(0, option.label.indexOf(' '))].map((char) => char.codePointAt(0) ?? 0);
    assert.equal(codePoints.length, 2, `标签缺少国旗：${option.label}`);
    codePoints.forEach((point) => {
      assert.ok(point >= 0x1f1e6 && point <= 0x1f1ff, `标签缺少国旗：${option.label}`);
    });
  });
});

test('Excel 导入的国家解析：多国组合取第一个认得的', () => {
  const mixed = resolveCountry('United Kingdom / New Zealand');
  assert.equal(mixed.value, '英国');
  assert.equal(mixed.mixed, true);
  assert.equal(mixed.unknown, false);

  // 第一个认不出来时往后找
  const skip = resolveCountry('Mars / Saudi Arabia / Switzerland');
  assert.equal(skip.value, '沙特阿拉伯');
  assert.equal(skip.mixed, true);
});

test('Excel 导入的国家解析：带城市补充的写法', () => {
  assert.equal(resolveCountry('Ireland (Dublin)').value, '爱尔兰');
  assert.equal(resolveCountry('Saudi Arabia (Jeddah)').value, '沙特阿拉伯');
  assert.equal(resolveCountry('United Arab Emirates (Dubai)').value, '阿联酋');
});

test('Excel 导入的国家解析：认不出来就原样保留，不瞎猜', () => {
  const unknown = resolveCountry('Atlantis');
  assert.equal(unknown.value, 'Atlantis');
  assert.equal(unknown.unknown, true);
  assert.equal(unknown.changed, false);
});

test('Excel 导入的国家解析：空值安全', () => {
  const empty = resolveCountry('');
  assert.equal(empty.value, '');
  assert.equal(empty.mixed, false);
  assert.equal(empty.unknown, false);
  assert.equal(resolveCountry(undefined).value, '');
});

test('Excel 导入的国家解析：普通写法只改写法不改含义', () => {
  const us = resolveCountry('United States');
  assert.equal(us.value, '美国');
  assert.equal(us.changed, true);
  assert.equal(us.mixed, false);

  const already = resolveCountry('美国');
  assert.equal(already.value, '美国');
  assert.equal(already.changed, false);
});
