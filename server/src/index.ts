export { loadFrozenRuleset } from "./ruleset/loadRuleset.js";
export { RulesetLoadError } from "./ruleset/errors.js";
export type {
  LoadedRuleset,
  RulesetFreeze,
  RulesetManifest,
  RulesetSettings,
} from "./ruleset/types.js";
export { EngineTransaction } from "./engine/transaction.js";
export type {
  DomainEvent,
  JsonValue,
  PendingDomainEvent,
  RevisionedState,
  TransactionCommit,
} from "./engine/types.js";
export { handCards, handZoneRef, orderedCards } from "./engine/state.js";
export type {
  AuthoritativeGameState,
  CardInstanceState,
  CombatState,
  DurationState,
  GameLifecycle,
  PendingWindowState,
  Phase,
  PlayerRuntimeState,
  RandomRecord,
  ResolutionFrame,
  ScheduledEffectState,
  SetupLifecycleState,
  StatusInstanceState,
  Team,
  ZoneState,
  ZoneType,
} from "./engine/state.js";
export {
  StateInvariantError,
  validateAuthoritativeState,
} from "./engine/stateValidation.js";
export {
  moveCard,
  moveCardAndProcessTriggers,
  moveCardInTransaction,
} from "./engine/zones.js";
export type {
  MoveCardInput,
  MoveKind,
  TriggeredMoveResult,
} from "./engine/zones.js";
export { advanceTimeline } from "./engine/timeline.js";
export type { PhaseDisposition } from "./engine/timeline.js";
export { finishManualPhase, resolvePhaseBody } from "./engine/phaseBody.js";
export {
  chooseWithSource,
  createRandomSource,
  shuffleWithSource,
} from "./engine/random.js";
export type { RandomResult, RandomSourceState } from "./engine/random.js";
export {
  drawCards,
  drawCardsInTransaction,
  ensureDrawPileInTransaction,
} from "./engine/deck.js";
export type { DrawCardsResult } from "./engine/deck.js";
export {
  calculateHandLimit,
  requiredDiscardCount,
} from "./engine/handLimit.js";
export { PhaseCommandSession } from "./engine/phaseCommands.js";
export type {
  AcceptedPhaseCommandResult,
  PhaseCommand,
  PhaseCommandRejectionCode,
  PhaseCommandResult,
  RejectedPhaseCommandResult,
} from "./engine/phaseCommands.js";
export { runAutomaticScheduler } from "./engine/automaticScheduler.js";
export type {
  AutomaticSchedulerResult,
  SchedulerStopReason,
} from "./engine/automaticScheduler.js";
export {
  calculateTargetOffer,
  validateTargetSelection,
} from "./engine/targets.js";
export type {
  CardTargetSpec,
  CharacterTargetSpec,
  TargetOffer,
  TargetSpec,
} from "./engine/targets.js";
export { payCostPlan, validateCostPlan } from "./engine/costs.js";
export type {
  CardCostSpec,
  CostPlan,
  CostSelections,
  CostSpec,
  LimitCostSpec,
  ValueCostSpec,
} from "./engine/costs.js";
export { executeAction } from "./engine/actions.js";
export type {
  ActionDefinition,
  ActionExecutionInput,
  ActionResolutionContext,
  ActionSelections,
  ActionTargetGroup,
} from "./engine/actions.js";
export {
  calculateBaseDistance,
  calculateEffectiveDistance,
} from "./engine/distance.js";
export { buildActionOffer } from "./engine/actionOffers.js";
export type {
  ActionOffer,
  CardCostOffer,
  CostOffer,
  FixedCostOffer,
} from "./engine/actionOffers.js";
export { ActionCommandSession } from "./engine/actionCommands.js";
export type {
  AcceptedActionCommand,
  ActionCommandRejectionCode,
  ActionCommandResult,
  ExecuteActionCommand,
  RegisteredAction,
  RejectedActionCommand,
} from "./engine/actionCommands.js";
export {
  setWeaponPreselection,
  weaponSlotRefs,
} from "./engine/preselection.js";
export {
  buildAttackOffer,
  commitAttack,
  resolvePreselectedAttackSource,
} from "./engine/attack.js";
export type {
  AttackOffer,
  CommitAttackInput,
  ResolvedAttackSource,
} from "./engine/attack.js";
export {
  AttackResponseSession,
  openAttackResponse,
} from "./engine/response.js";
export type {
  AttackResponseCommand,
  AttackResponseResult,
} from "./engine/response.js";
export { resolveCurrentAttackTarget } from "./engine/damage.js";
export type { AppliedDamageSegment } from "./engine/damage.js";
export {
  executeNextImmediateDamageEffect,
  hasImmediateDamageEffect,
} from "./engine/directDamage.js";
export {
  compileTriggerRegistry,
  matchTriggeredEffects,
} from "./engine/triggerRegistry.js";
export type {
  CompiledTriggerDefinition,
  MatchedTriggerCandidate,
  TriggerEventFact,
  TriggerPriorityName,
} from "./engine/triggerRegistry.js";
export { executeMatchedTrigger } from "./engine/triggerEffects.js";
export {
  openOptionalTriggerWindow,
  optionalTriggerCanResolveWithoutSelections,
  triggerCanResolveWithoutSelections,
  OptionalTriggerSession,
  openTriggerOrderingWindow,
  TriggerOrderingSession,
} from "./engine/triggerWindows.js";
export type {
  OptionalTriggerCommand,
  OptionalTriggerResult,
  TriggerOrderingCommand,
  TriggerOrderingResult,
} from "./engine/triggerWindows.js";
export {
  processCommittedEventTriggers,
  processEventTriggers,
} from "./engine/triggerBridge.js";
export type {
  TriggerBridgeResult,
  TriggerBridgeStopReason,
  TriggeredCommitResult,
} from "./engine/triggerBridge.js";
export {
  legalTriggerCardSelections,
  openTriggerCardSelectionWindow,
  triggerUsesSupportedCardSelection,
  TriggerCardSelectionSession,
} from "./engine/triggerCardSelection.js";
export type {
  TriggerCardSelectionCommand,
  TriggerCardSelectionResult,
} from "./engine/triggerCardSelection.js";
export {
  buildCriticalPenetrationOffer,
  isCriticalPenetrationTrigger,
  openCriticalPenetrationWindow,
  processCriticalPenetrationHitEvents,
  CriticalPenetrationSession,
} from "./engine/triggerAttackFollowup.js";
export type {
  CriticalPenetrationCommand,
  CriticalPenetrationOffer,
  CriticalPenetrationResult,
} from "./engine/triggerAttackFollowup.js";
export { DyingCommandSession, openDyingRescue } from "./engine/dying.js";
export type { DyingCommand, DyingCommandResult } from "./engine/dying.js";
export { runCombatUntilBlocked } from "./engine/combatScheduler.js";
export type {
  CombatSchedulerResult,
  CombatStopReason,
} from "./engine/combatScheduler.js";
export { AttackCommandSession } from "./engine/attackCommands.js";
export type {
  AttackCommand,
  AttackCommandResult,
} from "./engine/attackCommands.js";
export {
  applyStatus,
  applyStatusInTransaction,
  expireStatusesAtPhaseAfter,
  statusPhaseDisposition,
} from "./engine/status.js";
export type { ApplyStatusInput } from "./engine/status.js";
export {
  beginDesignatedJudgmentChoice,
  beginJudgment,
  finalizeJudgment,
  replaceJudgmentCard,
} from "./engine/judgment.js";
export type { BeginJudgmentInput, PrintedColor } from "./engine/judgment.js";
export { JudgmentInterventionSession } from "./engine/judgmentIntervention.js";
export type {
  JudgmentInterventionCommand,
  JudgmentInterventionResult,
} from "./engine/judgmentIntervention.js";
export { JudgmentDesignationSession } from "./engine/judgmentDesignation.js";
export type {
  JudgmentDesignationCommand,
  JudgmentDesignationResult,
} from "./engine/judgmentDesignation.js";
export {
  openPreJudgmentWindow,
  PreJudgmentSession,
} from "./engine/preJudgment.js";
export type {
  PreJudgmentCommand,
  PreJudgmentResult,
} from "./engine/preJudgment.js";
export { beginNextAttackJudgment } from "./engine/attackJudgment.js";
export { applyPendingAttackJudgmentEffects } from "./engine/attackJudgmentEffects.js";
export { applyAttackCriticalModifier } from "./engine/critical.js";
export {
  activateRoundShield,
  evaluateKillInvalidation,
  expireRoundShieldAtPrepareBefore,
} from "./engine/killInvalidation.js";
export type {
  KillInvalidationResult,
  KillPrintedColor,
} from "./engine/killInvalidation.js";
export {
  consumeGuaranteedCriticalForCommittedAttack,
  expireGuaranteedCriticalAtTurnEnd,
  grantGuaranteedCritical,
} from "./engine/guaranteedCritical.js";
export type { GuaranteedCriticalGrant } from "./engine/guaranteedCritical.js";
export {
  activateGhostCrownAtPlayEnd,
  ghostCrownInvalidates,
  recordChargeAction,
  recordCommittedWeaponAttack,
} from "./engine/armorRuntime.js";
export { finalizeCurrentAttack } from "./engine/attackLifecycle.js";
export {
  eliminateIronPirateAtSecondEndStart,
  eliminatePlayer,
  recordIronPiratePostDeathTurnStart,
  replaceEliminationWithIronPirate,
} from "./engine/deathReplacement.js";
export {
  continuePendingDarkKnightFinalStrike,
  DarkKnightFinalStrikeSession,
  handleDarkKnightBossLeave,
  replaceEliminationWithDarkKnightFinalStrike,
} from "./engine/darkKnightFinalStrike.js";
export type {
  DarkKnightFinalStrikeCommand,
  DarkKnightFinalStrikeResult,
} from "./engine/darkKnightFinalStrike.js";
export { createInitialSetup, resolveInitialRedraw } from "./engine/setup.js";
export {
  buildDeadlyCurseOffers,
  DeadlyCurseSession,
} from "./engine/traveler.js";
export type {
  DeadlyCurseCommand,
  DeadlyCurseOffer,
} from "./engine/traveler.js";
export {
  buildElementSatchelOffers,
  dismantlableCards,
  ElementSatchelSession,
} from "./engine/elementalist.js";
export type {
  ElementSatchelCommand,
  ElementSatchelOffer,
  SatchelMode,
} from "./engine/elementalist.js";
export {
  enterUnderground,
  exitUnderground,
  handleMinerOffTurnActivePlay,
  isUnderground,
  MinerSession,
  openMinerDigAtPlayEnd,
  openMinerNaturalExitAtPrepare,
  openMinerSourceDismantle,
} from "./engine/miner.js";
export type { MinerCommand } from "./engine/miner.js";
export {
  buildDemonicNatureOffers,
  DemonicNatureSession,
  hasDemonmancerShieldRecoveryRestriction,
  isPendingHellfireDamage,
  processDemonicNatureTargetAfterEvents,
  processDemonmancerHellfireEvents,
  tickDemonmancerPrepareDurations,
} from "./engine/demonmancer.js";
export type { DemonicNatureCommand } from "./engine/demonmancer.js";
export {
  buildNecromancerMarkOffers,
  NecromancerMarkSession,
  necromancerMarkExtraPotential,
  recordNecromancerAppliedDamage,
  tickNecromancerMarksAtPrepare,
} from "./engine/necromancer.js";
export type { NecromancerMarkCommand } from "./engine/necromancer.js";
export {
  buildRobotOverloadOffers,
  RobotOverloadSession,
} from "./engine/robot.js";
export type { RobotOverloadCommand } from "./engine/robot.js";
export {
  buildAssassinCreedKillOffers,
  AssassinCreedKillSession,
  expireAssassinCreedKillAtTurnEnd,
  onAssassinOwnerTurnStart,
  resetAssassinCreedKillAtPrepare,
} from "./engine/assassin.js";
export type { AssassinCreedKillCommand } from "./engine/assassin.js";
export {
  openPendingWizardSpellStrike,
  processWizardSpellStrikeHitEvents,
  WizardSpellStrikeSession,
} from "./engine/wizard.js";
export type { WizardSpellStrikeCommand } from "./engine/wizard.js";
export {
  buildQiBallOffers,
  processQiBallShieldBreaker,
  QiBallDismantleSession,
  QiBallSession,
} from "./engine/qiMaster.js";
export type { QiBallCommand } from "./engine/qiMaster.js";
export {
  buildBomberOffers,
  BomberSession,
  BombDetonationSession,
  grantBombsAfterAttack,
  openBombDetonation,
  tickTrapCooldown,
} from "./engine/trapMaster.js";
export type { CreateSetupInput, RedrawState, Seat } from "./engine/setup.js";
export {
  buildTalentDiscardOffers,
  buildTalentEquipOffers,
  hasTalentFamily,
  TalentDiscardSession,
  TalentEquipSession,
} from "./engine/talentEquipment.js";
export {
  applyTalentEquipContribution,
  resolveTalentContribution,
  setEquippedTalentContributionsEnabled,
} from "./engine/talentContributions.js";
export { beginPrecisionStrikeJudgment } from "./engine/precisionStrike.js";
export {
  buildStatuePlayOffers,
  beginStatueDoubleTrigger,
  completeStatueResolution,
  finishStatueEffectFlow,
  StatuePlaySession,
} from "./engine/statueDoubleTrigger.js";
export {
  beginStatueResolution,
  buildStatueResolutionOffers,
  openEngineerStatueAtJudgment,
  resumeStatueAfterDying,
  StatueChoiceSession,
  StatueResolutionSession,
} from "./engine/statueEffects.js";
export {
  BasicSupportCardSession,
  buildBasicSupportOffers,
  strongPotionBonus,
} from "./engine/basicSupportCards.js";
export {
  buildWeaponDiscardOffers,
  buildWeaponEquipOffers,
  WeaponDiscardSession,
  WeaponEquipSession,
} from "./engine/weaponEquipment.js";
export {
  buildMountDiscardOffers,
  buildMountEquipOffers,
  equippedMountRefs,
  MountDiscardSession,
  MountEquipSession,
} from "./engine/mountEquipment.js";
export { applyWeaponCommitEffects } from "./engine/weaponCommitEffects.js";
export { ParticleEagleFollowUpSession } from "./engine/attackLifecycle.js";
export { startScheduledWeaponAttackAtPrepare } from "./engine/weaponScheduled.js";
export { LaserRainSession } from "./engine/laserRain.js";
export { buildWeaponSynthesisOffers, WeaponSynthesisSession } from "./engine/weaponSynthesis.js";
export {
  buildVineOffers,
  processVineAfter,
  tickVineCooldown,
  VineSession,
} from "./engine/druid.js";
export {
  buildMechExitOffers,
  buildMechAttackOffers,
  EngineerMechChoiceSession,
  exitMech,
  MechAttackSession,
  MechExitSession,
  openEngineerMechAtPrepare,
} from "./engine/engineer.js";
export {
  projectAllSetupViews,
  projectRedrawOffer,
  projectSetupPresentationEvents,
  projectSetupView,
  SetupCommandSession,
} from "./engine/setupCommands.js";
export type {
  AcceptedCommandResult,
  CommandRejectionCode,
  RedrawCommand,
  RedrawOffer,
  RejectedCommandResult,
  SetupCommandResult,
  SetupInteraction,
  SetupPresentationEvent,
  SetupProjection,
  SetupSnapshot,
  VisibleSetupCard,
} from "./engine/setupCommands.js";
