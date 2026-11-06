// step-types.ts — re-export shared constants to keep single source of truth
export { STEP_TYPES } from 'posendy-chrome-shared';
export type StepTypeConst =
  (typeof import('posendy-chrome-shared'))['STEP_TYPES'][keyof (typeof import('posendy-chrome-shared'))['STEP_TYPES']];
