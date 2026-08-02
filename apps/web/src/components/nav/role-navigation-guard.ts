export const ROLE_SWITCH_UNSAVED_SELECTOR =
  '[data-role-switch-unsaved="true"]';

type QueryRoot = Pick<ParentNode, "querySelector">;

export function hasUnsavedRoleChanges(root: QueryRoot): boolean {
  return root.querySelector(ROLE_SWITCH_UNSAVED_SELECTOR) !== null;
}

export function canLeaveForRoleAction(input: {
  root: QueryRoot;
  confirmDiscard: () => boolean;
}): boolean {
  return !hasUnsavedRoleChanges(input.root) || input.confirmDiscard();
}
