// 角色与技能中文描述配置。key：characterId / abilityId。内容整理自
// docs/整理/16-v1.3.4角色规则正文.md（25 名角色正文）。

const FALLBACK = "暂未收录该角色的规则说明。";
const ABILITY_FALLBACK = "暂未收录该技能的规则说明。";

interface AbilityEntry {
  displayName: string;
  description: string;
}

const characterMap: Record<string, string> = {
  "character.knight": "骑士（血 6 · 盾 5）· 初始天赋 蓝盾。均衡的近战角色，骑士本能可将一张雕像牌转换为骑士雕像后打出。",
  "character.alchemist": "炼金术士（血 6 · 盾 5）· 初始天赋 毒盾。免疫毒伤害并强化毒伤；剧毒药剂可将绿色手牌化作不可闪的场地毒瓶。",
  "character.headtaker": "枭首者（血 4 · 盾 7）· 初始天赋 猫头鹰。每轮可对造成正伤害的来源发起吹箭反击；斯巴达飞踢可弃全手造成护盾伤害。",
  "character.werewolf": "狼人（血 8 · 盾 3）· 初始天赋 血箱。失去已装备防具回复 2 血；狼人笔记弃五色手牌，上限+1 回 1 血后再执行死亡笔记。",
  "character.paladin": "圣骑士（血 2 · 盾 10）· 初始天赋 碎盾。高护盾坦克；神圣屏障弃 2 张蓝牌免疫一个伤害段并获得无敌。",
  "character.elf": "精灵（血 5 · 盾 5）· 初始天赋 蓄力加快。蓄力需求-1；专注射击可瞄准伤害来源，对瞄准目标攻击不耗可攻击次数。",
  "character.ranger": "游侠（血 6 · 盾 4）· 初始天赋 暴击穿透。暴击命中后可不耗次数再出杀攻击另一角色；翻滚可将橙色手牌当【闪】并令下回合攻击必暴。",
  "character.taoist": "道士（血 4 · 盾 5）· 初始天赋 刺盾。近战首段伤害-1；乾坤挪移令远程攻击未命中时以原攻击者为新目标反弹攻击。",
  "character.priest": "牧师（血 5 · 盾 5）· 初始天赋 强力药水。药水/号角回复量+1；祈祷将红色手牌当回复 2 的药水，希望弃白色手牌回复 1 血。",
  "character.punching_bag": "拳击柱（血 10 · 盾 0）· 初始天赋 吸蓝。特别抗揍获得 12 点额外血层；惯性反击按来源累计实际伤害，来源结束阶段对其反弹真实伤害。",
  "character.interdimensional_traveler": "超界者（血 3 · 盾 2）· 初始天赋 平行穿梭。初始血量下限 3 并逐回合下降；绿/蓝令每段正数伤害无效；致命诅咒弃所有可弃牌标记目标并离场，第三回合处决目标。",
  "character.ancient_elementalist": "古代元素使（血 5 · 盾 6）· 初始天赋 元素本源。免疫火伤与冰冻；元素锦囊整局三次，可令目标冰冻、电击或拆其至多 2 张牌。",
  "character.miner": "矿工（血 4 · 盾 4）· 初始天赋 钱盾。回合外手牌超限时获得铁盾 1；掘地求生弃 1 张手牌遁地，远程攻击对其无效，自然退出时造成 1 点场地伤害。",
  "character.demonmancer": "恶魔术士（血 4 · 盾 4）· 初始天赋 地狱烈火。攻击造成正数伤害后判定，白/红追加 1 点火伤；恶魔本性消耗全部攻击次数对两名目标发动烈焰焚烧并回盾。",
  "character.necromancer": "死灵法师（血 6 · 盾 4）· 初始天赋 灵魂打击。按实际造成伤害获得能量（上限 8）；死灵标记消耗 8 能量令目标铁盾-1 并记录额外伤害。",
  "character.robot": "机器人（血 4 · 盾 7）· 初始天赋 电盾。免疫电击、激光破除防具、感电总伤+1；能量过载弃 2 张手牌对全场发起激光 2 攻击。",
  "character.assassin": "刺客（血 5 · 盾 6）· 初始天赋 近反。近战格挡后反弹攻击；刺客信条可用 2 张同色手牌当【闪】或【杀】打出，各每轮 1 次。",
  "character.wizard": "法师（血 5 · 盾 5）· 初始天赋 元爆。火/毒/感电元素总伤+1；法术打击在【杀】攻击命中后弃 1 张手牌判定，按颜色追加效果。",
  "character.qi_master": "气宗（血 6 · 盾 6）· 初始天赋 龟派气功。手刀基础伤害+1；元气蛋蛋弃 2 张手牌发起远程 2 元气弹，并按当前天赋追加效果。",
  "character.trap_master": "陷阱大师（血 7 · 盾 3）· 初始天赋 吸炸。每满 2 点实际血量伤害获得 1 个炸弹；炸弹可抵消伤害或在准备阶段引爆为场地伤害。",
  "character.engineer": "工程师（血 6 · 盾 5）· 初始天赋 火盾。免疫火并强化火伤；机械狂魔令其在开局后进入机甲形态，机甲拥有独立护盾与武器。",
  "character.druid": "德鲁伊（血 5 · 盾 5）· 初始天赋 适应进化。首次完整承受某种元素伤害后永久获得该元素减免 1；藤蔓缠绕发起破除防具的毒伤并令目标下回合摸牌-2。",
  "character.berserker": "狂战士（血 8 · 盾 4）· 初始天赋 三持。常规武器槽增至 3；狂战可少摸 1/2 张使本回合首次武器攻击必定暴击，少摸 2 额外加 1 次攻击次数。",
  "character.shaman": "萨满（血 4 · 盾 5）· 初始天赋 未卜先知。摸牌改为展示 N+2 选 N；逆天改命弃 2 张同色手牌直接指定判定结果，每轮 1 次。判定替换窗口为萨满专属。",
  "character.general": "将军（血 11 · 盾 1）· 初始天赋 汪汪队。任意角色结束阶段对全员发起近战 1 护盾伤害攻击；迫击炮对全员直接造成 3 点场地普通伤害。",
};

const abilityMap: Record<string, AbilityEntry> = {
  "talent.blue_shield": { displayName: "蓝盾", description: "每段伤害开始时若仍有护盾，该段普通伤害扣完护盾后不溢出到血量；多段伤害逐段重新检查。" },
  "skill.knight.instinct": { displayName: "骑士本能", description: "主动：自己的出牌阶段限一次。选择一张雕像牌，将本次名称、身份和效果转换为骑士雕像后打出；必须公开显示转换。该牌保留印刷颜色，可被圣骑士雕像响应，结算离场前恢复原模板。" },
  "talent.poison_shield": { displayName: "毒盾", description: "锁定：免疫毒伤害。每次攻击对每名目标造成毒伤害时，使该目标对应毒伤段数+1；单段视为 x×1。" },
  "skill.alchemist.toxic_reagent": { displayName: "剧毒药剂", description: "主动：自己的出牌阶段限一次，将一张绿色手牌当毒瓶打出。创建距离 2、单目标的场地攻击，命中产生毒伤害 1×2；不可闪、不可近战格挡、无视防具。不受毒盾等天赋加成。" },
  "talent.owl": { displayName: "猫头鹰", description: "触发：每轮限一次。一名来源对枭首者的全部伤害段结束后，若该来源实际造成过正数伤害，可选择对其发起一次距离不限、远程 2 的吹箭攻击。" },
  "skill.headtaker.spartan_kick": { displayName: "斯巴达飞踢", description: "主动：自己的弃牌阶段可以弃置全部手牌（至少 1 张，记为 x），选择一名在场角色直接造成 x 点护盾伤害。若未令其破盾，目标下回合摸牌-1；若破盾，枭首者下回合摸牌-1。减摸牌可叠加。" },
  "talent.blood_box": { displayName: "血箱", description: "触发：因任何原因失去已装备防具时回复 2 血；主动替换、主动丢弃、拆除和作为合成材料离场均可触发。" },
  "skill.werewolf.notebook": { displayName: "狼人笔记", description: "主动，整局 2 次：指定一名在场角色并弃置白、绿、蓝、橙、红手牌各 1 张；随后血量上限+1 并回复 1 血，再执行死亡笔记。目标有护盾则将其护盾修改为 0，无护盾则将其血量修改为 1。" },
  "talent.shield_breaker": { displayName: "碎盾", description: "触发：圣骑士护盾从大于 0 变为 0 时，可以拆除该伤害来源一张合法牌。" },
  "skill.paladin.divine_barrier": { displayName: "神圣屏障", description: "主动/响应，CD=1，共享同一冷却：即将受到一个伤害段时弃置任意合法区域中的 2 张蓝色牌，免疫该伤害段并获得无敌；也可在自己的出牌阶段弃置相同费用只获得无敌。无敌持续到圣骑士下个准备阶段开始前。" },
  "talent.charge_acceleration": { displayName: "蓄力加快", description: "锁定：蓄力武器每档所需蓄力次数-1，最低可降为 0；0 次档可直接使用，但不产生蓄力动作。" },
  "skill.elf.gather_strength": { displayName: "养精蓄锐", description: "主动：自己的出牌阶段不限次数；消耗 1 次可攻击次数，摸 1 张牌。" },
  "skill.elf.focused_shot": { displayName: "专注射击", description: "被动：一名来源对精灵的全部伤害段结束后，若造成血量伤害，则瞄准该来源。对瞄准目标攻击不消耗可攻击次数；整次攻击对其造成血量伤害后解除瞄准。" },
  "skill.elf.focus_aim": { displayName: "专注瞄准", description: "主动：自己的出牌阶段限一次，弃置 2 张手牌并瞄准一名在场角色。" },
  "talent.critical_penetration": { displayName: "暴击穿透", description: "触发：一次武器攻击暴击命中后，可再打出一张【杀】，不消耗攻击次数，使用原攻击武器额外攻击另一名角色；额外攻击不能再次触发暴击穿透。" },
  "skill.ranger.roll": { displayName: "翻滚", description: "响应：需要出闪时可将一张橙色手牌当【闪】打出。若如此，游侠自己的下个回合中所有以【杀】发起的攻击必定暴击；到该回合结束时清除。" },
  "talent.spike_shield": { displayName: "刺盾", description: "锁定：受到一次近战攻击时，该攻击的第一个正数伤害段-1，最低 0。" },
  "skill.taoist.attack_reflection": { displayName: "乾坤挪移", description: "触发：以出闪、防具闪避、近战格挡等方式令远程攻击未命中时，复制原攻击尚未结算的完整参数，以原攻击者为来源、原攻击者为新目标发起反弹攻击，不支付资源。同一攻击链最多反弹 10 次。" },
  "talent.strong_potion": { displayName: "强力药水", description: "锁定：牧师实际打出的药水或号角回复量+1；技能明确不受天赋时除外。" },
  "skill.priest.pray": { displayName: "祈祷", description: "主动/响应：每轮共享限一次，在回合外需要药水时或自己的出牌阶段，将一张红色手牌当回复 2 血的药水打出；不受强力药水加成。额度在准备阶段重置。" },
  "skill.priest.hope": { displayName: "希望", description: "主动：自己的出牌阶段限一次，弃置一张白色手牌，使一名在场角色回复 1 血；不受强力药水加成。" },
  "talent.mana_siphon": { displayName: "吸蓝", description: "触发：一次攻击对一名其他角色累计造成至少 2 点实际血量伤害后摸 1 张；同一目标每次攻击最多触发一次，多目标分别统计。" },
  "skill.punching_bag.extra_health": { displayName: "特别抗揍", description: "锁定：开局获得 12 点不可回复的额外血量层，优先于普通护盾和血量承伤；除不能回复外按血量处理。修改血量也先作用该层，单段可溢出到后续层。" },
  "skill.punching_bag.inertial_counter": { displayName: "惯性反击", description: "锁定：分别累计每名来源对拳击柱实际造成且尚未反击的全部伤害，包括额外血量层、护盾和普通血量。每名来源自己的结束阶段对其依次直接造成 floor(x/3) 次 1 点真实伤害并保留余数。" },
  "talent.parallel_traversal": { displayName: "平行穿梭", description: "锁定：初始血量下限为 3，只在超界者自己的结束阶段使血量下限-1，最低-1。以超界者为来源或目标的每个即将造成的正数伤害段分别判定；绿或蓝令该段无效。" },
  "skill.interdimensional_traveler.deadly_curse": { displayName: "致命诅咒", description: "限定，整局 1 次：自己的出牌阶段仍有可攻击次数且所有区域牌合计至少 8 张时，弃置所有可弃牌并标记一名在场角色。超界者立即离场，天赋永久失效；第 3 次轮到时处决标记目标并回归。" },
  "talent.element_origin": { displayName: "元素本源", description: "锁定：免疫火伤害和冰冻。" },
  "skill.ancient_elementalist.element_satchel": { displayName: "元素锦囊", description: "限定，整局 3 次且每个出牌阶段限一次：指定一名在场角色，从尚未使用的选项中选择一项——冰冻锦囊令其冰冻；雷电锦囊令其电击；烈焰锦囊拆其至多 2 张可拆牌。" },
  "talent.money_shield": { displayName: "钱盾", description: "锁定：回合外手牌数大于等于当前手牌上限时获得铁盾 1。" },
  "skill.miner.dig_for_survival": { displayName: "掘地求生", description: "主动：自己的出牌阶段结束时弃置 1 张手牌进入遁地，持续到矿工下个准备阶段开始。遁地期间获得铁盾 1，远程攻击对其无效；实际受正伤、主动响应或任意回合外主动出牌时退出遁地。自然持续到准备阶段时先造成 1 点场地伤害再正常准备。" },
  "talent.hellfire": { displayName: "地狱烈火", description: "触发：每次攻击对每名目标的原始伤害段完成后，若实际造成过正数伤害，判定一次；白或红时对当前目标追加 1 点火伤害。多目标分别判定。" },
  "skill.demonmancer.demonic_nature": { displayName: "恶魔本性", description: "限定，整局 1 次：仍有 x 次可攻击次数时选择 2 名不同在场角色并消耗全部 x 次，按逆时针逐个发动烈焰焚烧（不可近战格挡、破除防具、命中 3 点普通伤害）。两名目标处理完后回复 2 血、护盾上限+1 并回复 1 盾。被命中目标连续 x+1 次准备阶段不能自动回盾。" },
  "talent.soul_strike": { displayName: "灵魂打击", description: "锁定：按死灵法师实际造成的伤害点数获得等量能量，上限 8；0 伤和修改数值不获得。" },
  "skill.necromancer.mark": { displayName: "死灵标记", description: "主动：自己的出牌阶段消耗 8 能量标记一名在场角色。标记令其铁盾-1 并记录因此增加的伤害（累计上限 8），持续到死灵法师两个回合后的准备阶段开始前。同一目标再次施加刷新持续期并重置额外伤害累计。" },
  "talent.electric_shield": { displayName: "电盾", description: "锁定：免疫电击。激光攻击破除防具；激光本身不可近战格挡。每次攻击对每名目标造成感电伤害时，使该目标感电总伤+1，增加到第一个正数感电段。" },
  "skill.robot.energy_overload": { displayName: "能量过载", description: "主动：自己的出牌阶段限一次，弃置 2 张手牌，对机器人之外所有在场角色按逆时针逐个发起距离不限、激光 2 攻击；可闪、不可近战格挡、不破除防具，不受电盾或其他天赋加成。" },
  "talent.melee_counter": { displayName: "近反", description: "触发：刺客使用近战武器格挡攻击后，按反弹规则对原攻击者发起反弹攻击。" },
  "skill.assassin.creed_dodge": { displayName: "刺客信条·闪", description: "响应，每轮 1 次：需要出闪时，将 2 张同色手牌当【闪】打出；随后获得防御距离+1，持续到刺客下个准备阶段开始前。" },
  "skill.assassin.creed_kill": { displayName: "刺客信条·杀", description: "主动，每轮 1 次：自己的出牌阶段将 2 张同色手牌当【杀】打出；在刺客自己的下个回合获得进攻距离-1。两个额度独立，在刺客准备阶段重置。" },
  "talent.elemental_burst": { displayName: "元爆", description: "锁定：每次攻击对每名目标造成火、毒、火毒或感电伤害时，该目标对应元素总伤+1；冰、电是控制，不计元素伤害。" },
  "skill.wizard.spell_strike": { displayName: "法术打击", description: "触发：每次以【杀】发起的攻击命中后最多发动一次；弃置 1 张手牌并判定。红追加火伤 1×2；橙电击；蓝冰冻；绿追加毒伤 1×2；白无效果。多段攻击只触发一次，暴击穿透的新攻击可另行触发。不受元爆。" },
  "talent.qigong": { displayName: "龟派气功", description: "锁定：手刀基础伤害+1。" },
  "skill.qi_master.qi_ball": { displayName: "元气蛋蛋", description: "主动：自己的出牌阶段限一次，弃置 2 张手牌，选择距离不限的一名在场角色，消耗 1 次可攻击次数且不支付【杀】，发起远程 2 元气弹攻击。元气弹按气宗当前有效天赋追加效果。" },
  "talent.bomb_siphon": { displayName: "吸炸", description: "触发：一次攻击结算后汇总陷阱大师对其他角色造成的实际血量伤害，每满 2 点获得 1 个炸弹；直接伤害和修改血量不触发。" },
  "skill.trap_master.bomber": { displayName: "炸弹人", description: "主动，CD=2：自己的出牌阶段弃置 1 至 5 张手牌，每张转为 1 个公开炸弹标记。炸弹可抵消伤害（锁定）；准备阶段可引爆，每个炸弹形成 1 点场地伤害段，准备阶段结束时全部清空。" },
  "skill.trap_master.bomb_defense": { displayName: "炸弹防御", description: "锁定：每个伤害段经过免疫、减伤和铁盾后，强制消耗 min(炸弹数, 铁盾后伤害值) 个炸弹逐点抵消；最终 0 伤不视为受到伤害。" },
  "skill.trap_master.bomb_detonation": { displayName: "炸弹引爆", description: "主动：陷阱大师准备阶段，若至少有 1 个炸弹，可选择一名在场角色发起距离不限的场地攻击，每个炸弹形成 1 点场地伤害段。无论是否发动或命中，准备阶段结束时全部炸弹清空。" },
  "talent.fire_shield": { displayName: "火盾", description: "锁定：免疫火伤害。每次攻击对每名目标造成火伤害时，使对应火伤段数+1。" },
  "skill.engineer.mech_maniac": { displayName: "机械狂魔", description: "锁定：从开局到退甲前不能装备任何装备牌。第一次准备阶段选择一种机甲进入机甲形态，第 4 次准备阶段开始退甲；也可主动退甲，退甲后本局不能再次进入。机甲武器为唯一有效预选，攻击仍需【杀】和次数；普通/护盾/血量伤害优先作用机甲护盾。" },
  "talent.adaptive_evolution": { displayName: "适应进化", description: "锁定：首次完整承受某种元素伤害后，永久获得该元素减免 1，不减免首次。每种元素只获得一次；减免在铁盾前使该元素总伤-1；火毒可分别-1，合计最多-2。" },
  "skill.druid.vine_entanglement": { displayName: "藤蔓缠绕", description: "主动，CD=1：自己的出牌阶段选择距离 2 的一名在场角色，发起藤蔓攻击：不可近战格挡、破除防具，毒伤害 1；命中后令目标下回合摸牌-2，实际摸牌最低 0，可与其他减摸牌叠加。" },
  "talent.triple_wield": { displayName: "三持", description: "锁定：常规武器槽由 2 增至 3。失去或失效导致槽位降回 2 时，若有 3 把常规武器，立即选择 1 把弃置；超时属于强制选择，由服务端随机。" },
  "skill.berserker.rage": { displayName: "狂战", description: "主动：自己的摸牌阶段开始、实际摸牌前选择不发动、少摸 1 或少摸 2。少摸 1 或 2 均令本回合第一次正式发起的武器攻击必定暴击；少摸 2 额外使本回合可攻击次数+1。杀被盾牌/圆盾提前无效不消耗必暴额度；回合结束清除。" },
  "talent.foresight": { displayName: "未卜先知", description: "锁定：应摸 N 张时改为展示牌堆顶 N+2 张并选择 N 张加入手牌，N 最低 0；未选择牌进入弃牌堆。摸牌阶段被跳过时不展示。" },
  "skill.shaman.defy_fate": { displayName: "逆天改命", description: "响应，每轮 1 次：即将进行判定时打出 2 张同色手牌，令该次判定不翻牌，由萨满直接指定最终结果。使用后直到萨满下个准备阶段重置。判定干预与逆天改命窗口均为萨满专属。" },
  "talent.dog_squad": { displayName: "汪汪队", description: "锁定，全场触发：任意角色的结束阶段，对所有在场角色（包括将军）按逆时针逐个发起距离不限、近战 1 点护盾伤害攻击；指回将军的反弹不再生成无限反弹。" },
  "skill.general.mortar": { displayName: "迫击炮", description: "主动，CD=2：自己的出牌阶段，对所有在场且可受效果角色（包括将军）按逆时针逐个直接造成 3 点场地普通伤害；每名目标完成伤害与濒死后再继续下一名。" },
};

export function describeCharacter(characterId: string): string {
  return characterMap[characterId] ?? FALLBACK;
}

export function describeAbility(abilityId: string): string {
  return abilityMap[abilityId]?.description ?? ABILITY_FALLBACK;
}

export function abilityDisplayName(abilityId: string): string {
  return abilityMap[abilityId]?.displayName ?? abilityId;
}
