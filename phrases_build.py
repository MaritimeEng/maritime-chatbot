# -*- coding: utf-8 -*-
"""
揚投錨実習フレーズ（Word）→ phrases.json 変換

テンプレートの記法（このスクリプト内だけで使用）
  {1:a|b}  意味の変わる選択肢（日本語にも対応あり）→ 別々の問題に展開。同じ番号は連動する
  <a|b>    言い換え（意味は同じ）→ 1問にまとめ、どれでも正解
  (a)      省略可能な語 → 表示には含め、省略しても正解
  (a|b)    省略可能な言い換え
"""
import json, re, itertools

MEANING = re.compile(r"\{(\d+):([^{}]*)\}")
FLEX = re.compile(r"<([^<>]*)>|\(([^()]*)\)")
CAP = 128

def meaning_ids(t):
    ids = {}
    for m in MEANING.finditer(t):
        ids.setdefault(int(m.group(1)), len(m.group(2).split("|")))
    return ids

def apply_meaning(t, choice):
    return MEANING.sub(lambda m: m.group(2).split("|")[choice[int(m.group(1))]], t)

def clean(s):
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"\s+([,.?!。、？])", r"\1", s)
    s = re.sub(r"^[\s,、]+", "", s)
    return s.strip()

def flex_variants(t):
    """(canonical, [全ての許容形]) を返す"""
    parts, last = [], 0
    for m in FLEX.finditer(t):
        parts.append([t[last:m.start()]])
        if m.group(1) is not None:
            parts.append(m.group(1).split("|"))
        else:
            parts.append(m.group(2).split("|") + [""])
        last = m.end()
    parts.append([t[last:]])
    canonical = clean("".join(p[0] for p in parts))
    out = []
    for combo in itertools.product(*parts):
        v = clean("".join(combo))
        if v and v not in out:
            out.append(v)
        if len(out) >= CAP:
            break
    return canonical, out

def expand(en, ja, note="", extra_en=(), extra_ja=()):
    ids_en, ids_ja = meaning_ids(en), meaning_ids(ja)
    assert ids_en == ids_ja, f"選択肢の番号・数が英日で不一致: {en} / {ja}"
    keys = sorted(ids_en)
    items = []
    for combo in itertools.product(*[range(ids_en[k]) for k in keys]):
        choice = dict(zip(keys, combo))
        e_can, e_all = flex_variants(apply_meaning(en, choice))
        j_can, j_all = flex_variants(apply_meaning(ja, choice))
        e_acc = [v for v in e_all if v != e_can]
        for x in extra_en:
            e_acc += flex_variants(apply_meaning(x, choice))[1]
        j_acc = [v for v in j_all if v != j_can]
        for x in extra_ja:
            j_acc += flex_variants(apply_meaning(x, choice))[1]
        item = {"en": e_can, "ja": j_can}
        e_acc = [v for i, v in enumerate(e_acc) if v not in e_acc[:i] and v != e_can]
        j_acc = [v for i, v in enumerate(j_acc) if v not in j_acc[:i] and v != j_can]
        if e_acc: item["enAccept"] = e_acc
        if j_acc: item["jaAccept"] = j_acc
        if note: item["note"] = note
        items.append(item)
    return items

P3 = "{1:port anchor|starboard anchor|both anchors}"
P3J = "{1:左舷|右舷|両舷}"

ANCHOR = [
  ("What is the distance to the {1:anchorage|next way point}?", "{1:錨地|次の変針点}までの距離は？"),
  ("X {2:miles|cables} to the {1:anchorage|next way point}, Sir.", "{1:錨地|次の変針点}までX{2:マイル|ケーブル}です。"),
  ("What is our position?", "位置は？"),
  ("X cables {1:left|right} (of the charted course line), Sir.", "(コースラインの){1:左|右}Xケーブルです。"),
  ("What is the bearing to the {1:anchorage|next way point}?", "{1:錨地|次の変針点}の方向は？"),
  ("The bearing to the {1:anchorage|next way point} is X degrees.", "{1:錨地|次の変針点}の方向、X度です。"),
  ('Announce "Man your stations for {1:anchoring|leaving anchorage}."', "「{1:投錨|抜錨}用意、部署につけ」のマイクかけよ。"),
  ("Announcement made, Sir.", "マイクかけました。"),
  ("Anchoring instruction. {1:Port|Starboard} anchor, X shackles {2:on deck|in the water}. Charted depth (is) Y meters.",
   "投錨指示。{1:左舷|右舷}錨。X節{2:デッキ|水}。予定水深Yメートル。"),
  ("Walk <back|out> " + P3 + " {2:half a shackle|one shackle|until the water's edge}.", P3J + "錨を{2:半節|1節|水面まで}巻き出せ。"),
  ("Stand by " + P3 + " for letting go.", P3J + "錨準備。"),
  ("{1:Port anchor|Starboard anchor|Both anchors} ready (for letting go). Bridge understood. Stand by.", P3J + "錨準備完了、ブリッジ了解。待機せよ。"),
  ("Bridge, (this is) forward station. Standing by.", "船橋、こちらおもて、待機します。"),
  ("Switch on echo sounder. Echo sounder switched on, Sir.", "エコーサウンダのスイッチ入れろ。エコーサウンダ、スイッチ入れ。"),
  ("What is the depth? The depth is X meters.", "水深は？水深はXメートルです。"),
  ("<Report|Let me know> if she does not answer the wheel.", "舵効かなくなったら知らせ。"),
  ("She is not answering the wheel, Sir.", "舵効きません。", "", ["<The rudder has no effect|I cannot steer>, Sir."]),
  ("<The rudder has no effect|I cannot steer>, Sir.", "舵効きません。", "", ["She is not answering the wheel, Sir."]),
  ("<We have|There is> {1:enough|slight|no} {2:headway|sternway}.", "{2:前進|後進}行き脚、{1:十分|わずか|ありません}。"),
  ("We are dead in the water.", "完全に停止しています。"),
  ("{1:Engage|Disengage} clutch. Clutch {1:engaged|disengaged}.", "クラッチ{1:入れろ|はずせ}。クラッチ{1:入れた|はずした}。"),
  ("{1:Tighten|Loosen} brake. Brake {1:tightened|loosened}.", "ブレーキ{1:かけろ|緩めろ}。ブレーキ{1:かけた|緩めた}。"),
  ("{1:Release|Apply} stopper. Stopper {1:released|applied}.", "ストッパー{1:はずせ|かけろ}。ストッパー{1:はずした|かけた}。"),
  ("Hold on cable.", "錨鎖を止めろ。"),
  ("Shioji-Maru forward station, Bridge. Let go anchor.", "汐路丸おもて、こちらブリッジ。レッコアンカー。", "",
   ["<Shiojimaru|Shioji Maru> forward station, Bridge. Let go anchor."]),
  ("Take anchor bearings and fix the anchor position.", "クロスベアリングで錨位を確定せよ。"),
  ("Put X shackles in the water and hold on cable.", "X節水で錨鎖を止めよ。"),
  ("X shackles in the water. Holding on cable.", "X節水(で錨鎖を止めています)。"),
  ("Vessel brought up, Sir.", "ブロートアップ・アンカー。"),
  ("Make fast {1:port|starboard} cable. {1:Port|Starboard} cable made fast, Sir.", "メイクファースト{1:ポート|スターボード}ケーブル。"),
  ("Dismiss forward station. Forward station dismissed, Sir.", "船首、部署開け。船首部署開きます。"),
  ("Man your stations for <weighing anchor|leaving anchorage>.", "抜錨用意、部署につけ。"),
  ("Stand by {1:port|starboard} anchor for heaving up.", "{1:左舷|右舷}錨、巻き上げ用意。"),
  ("{1:Port|Starboard} anchor (is) ready for heaving up, Sir.", "{1:左舷|右舷}錨、巻き上げ準備完了です。"),
  ("Start GS pump. GS pump started.", "GSポンプ起動。GSポンプ起動しました。"),
  ("Heave up {1:port|starboard} anchor.", "{1:左舷|右舷}錨、巻き上げ。"),
  ("Report (the) cable direction and <weight|tension>.", "錨の方向と張り具合を報告せよ。"),
  ("(The) cable (is) leading X o'clock, (becoming|getting) {1:slack|tight}.", "X時の方向、{1:ゆるんで|張って}(きて)います。"),
  ("How is the cable leading?", "錨鎖の方向は？"),
  ("(The) cable (is) leading {1:X o'clock|up and down}.", "錨鎖の方向は{1:X時|真下}です。"),
  ("(The) cable (is) leading round the bow.", "錨鎖は船首を回っています。"),
  ("(The) cable (is) leading {1:ahead|abeam|astern}.", "錨鎖は{1:船首|正横|船尾}方向に延びています。"),
  ("Too much weight (is) on (the) cable.", "錨鎖に重みがかかりすぎです。"),
  ("We cannot heave up.", "巻き上げられません。"),
  ("{1:Start|Stop} heaving up. I will use {2:ahead|astern} engine.", "巻き上げ{1:開始|停止}。機関{2:前進|後進}をかける。"),
  ("Anchor is aweigh. Anchor sighted and clear.", "立錨です。錨見え、クリアです。"),
  ("Anchor sighted and clear. (There is) a lot of mud on anchor.", "錨見え、クリアです。錨に多くの泥がついています。"),
  ("Put anchor (back) in the water and report when anchor is clear of mud. I now start increasing speed.",
   "錨を水中に降ろし、泥が取れたら報告。これより増速を開始する。"),
  ("Bridge, forward station. Anchor is clear of mud. We are ready to secure anchor, Sir.",
   "船橋へ、こちらおもてです。錨から泥が取れました。錨おさめる用意が整いました。"),
  ("Secure anchor. Anchor secured.", "錨おさめよ。錨おさめました。"),
  ("Bridge, forward station. May I have permission to V?", "船橋へ、こちらおもてです。Vしてもよろしいでしょうか？"),
  ("Forward station, Bridge. Requesting permission to V.", "おもて、こちら船橋。Vする許可を求めている。了解。"),
  ("Captain, forward station is requesting permission to V.", "キャプテン、おもてがVする許可を求めています。"),
  ("(Forward station is requesting permission to V.) Copy. Permission granted.", "おもてがVする許可を求めている。了解。許可する。", "船長の発言"),
  ("Forward station, Bridge. You have permission to V.", "おもて、こちら船橋。Vする許可が得られた。"),
]

HARBOR = [
  ('Announce "Man your stations for {1:leaving|entering} port."', "「{1:出港|入港}用意部署につけ」のマイクかけよ。"),
  ("Announcement made, Sir.", "マイクかけました。"),
  ("All stations, (this is) Bridge. How do you read me? Over.", "各部署、こちら船橋。感度いかが？どうぞ。"),
  ("Bridge, (this is) forward station. I read you loud and clear. How do you read me? Over.",
   "船橋、こちらおもて。感度良好です。こちらから感度いかがですか？どうぞ。"),
  ("Forward station, (this is) Bridge. I read you loud and clear. Over.", "おもて、こちら船橋。感度良好です。どうぞ。"),
  ("Bridge, (this is) forward station. Manned and ready, Sir.", "船橋、こちらおもて。配置につきました。"),
  ("Is propeller clear?", "プロペラはクリアか？"),
  ("(All) clear aft, Sir.", "ともクリア。", "", ["Aft clear, Sir."]),
  ("What is the distance to the <dock|berth>?", "(おもて、)岸壁までの距離知らせ？"),
  ("Let me know when the stern is clear of the <dock|berth>.", "(とも、)船尾が岸壁をかわったら知らせ。"),
  # Describing Traffic Situation
  ("(There is) (a) {1:crossing|meeting} vessel X {2:points|degrees} on our {3:port|starboard} bow.",
   "{3:左舷|右舷}X{2:ポイント|度}に{1:横切り船|反航船}です。"),
  ("(There is) ({1:an|a}) {1:overtaking|same-way} vessel X {2:points|degrees} on our {3:port|starboard} quarter.",
   "{3:左舷|右舷}後方よりX{2:ポイント|度}に{1:追い越し船|同航船}です。", "",
   ["There is a {1:overtaking|same-way} vessel X {2:points|degrees} on our {3:port|starboard} quarter."]),
  ("(There is) (a) vessel X {1:points|degrees} abaft our {2:port|starboard} beam.", "本船の{2:左舷|右舷}正横後X{1:ポイント|度}に船舶。"),
  ("X is on our {1:port|starboard} beam.", "{1:左舷|右舷}正横にX。"),
  ("We are {1:ahead|abeam|astern} of X.", "本船はXの{1:前方|正横|後方}です。"),
  ("X is dead ahead of us.", "Xが正船首にあります。"),
  ("Vessel astern of us will overtake us on our {1:port|starboard} side.", "本船の後方の船舶は本船の{1:左舷|右舷}側を追い越します。"),
  ("X will {1:cross ahead of us|pass astern of us}.", "Xは{1:本船の前を横切ります|本船のともをかわります}。"),
  ("Vessel ahead of us is on <opposite|reciprocal> course.", "本船の前方の船舶は反航船だ。"),
  ("X is on the same course.", "Xは同航船だ。"),
  ("X is past and clear.", "Xは航過しました。"),
  # Handing Over the Watch
  ("Let me brief you before handing over the watch.", "当直引継ぎを行います。"),
  ("Our present course and speed is X degrees and Y knots.", "現在のコースとスピードはX度、Yノット。"),
  ("Crossing vessel 3 points on our port bow. <Its|Her> bearing is changing {1:forward|aft}. <It|She> will {1:cross ahead|pass astern} of us.",
   "左舷3ポイントに横切り船。ベアリング{1:おもて|とも}に向かって変わっています。本船の{1:前を横切り|船尾をかわり}ます。"),
  ("Vessel 45 degrees on our {1:starboard|port} bow. <Its|Her> bearing is 120 degrees, constant. We must {1:give way|stand on}.",
   "{1:右舷|左舷}45度に船舶。ベアリング120度でかわりません。本船が{1:避航|(針路速力を)保持}しなければなりません。"),
  ("<Meeting vessel|Vessel on opposite course> ahead of us. CPA is one mile. TCPA is 15 minutes.", "前方に反航船。CPA1マイル。TCPA15分です。"),
  ("Meeting vessel dead ahead of us. We must alter course to starboard.", "正船首に反航船。右に変針しなければなりません。"),
  ("<Same-way vessel|Vessel on the same course|Vessel on same course> astern of us. <It|She> will overtake us on our starboard side.",
   "本船の後方に同航船。本船よりスピードが速く右舷側を追い越すことになります。"),
  ("There are no dangerous targets.", "危険な船舶はありません。"),
  ("You have the watch.", "当直を引き継ぎます。"),
  ("I have the watch.", "当直を引き継ぎました。"),
]

def build(rows):
    out = []
    for r in rows:
        en, ja = r[0], r[1]
        note = r[2] if len(r) > 2 else ""
        extra = r[3] if len(r) > 3 else []
        out += expand(en, ja, note, extra)
    return out

anchor, harbor = build(ANCHOR), build(HARBOR)
data = {
  "_note": "揚投錨実習フレーズ（Word）から変換。[] の選択肢は問題ごとに展開済み。enAccept / jaAccept は正解として認める別の言い方（省略形・言い換え）。",
  "anchor": anchor,
  "harbor": harbor
}
json.dump(data, open("/mnt/user-data/outputs/maritime-english-system/phrases.json", "w"), ensure_ascii=False, indent=2)
print(f"原文: 投錨・抜錨 {len(ANCHOR)} 行 → {len(anchor)} 問（{-(-len(anchor)//15)} セット）")
print(f"原文: 出入港・当直 {len(HARBOR)} 行 → {len(harbor)} 問（{-(-len(harbor)//15)} セット）")
for x in anchor[:4] + anchor[20:23]:
    print(" ", x["en"], "|", x["ja"], "| accept:", x.get("enAccept", [])[:2])
