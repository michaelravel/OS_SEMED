// Fachada estável das Server Actions. Os consumidores existentes podem manter
// o mesmo import enquanto cada domínio evolui de forma independente.
export { login, loginWithGoogle, logout } from "./actions/auth";
export {
  addMessage,
  addServiceEntry,
  assignOrder,
  cancelOrder,
  changeStatus,
  completeOrder,
  createOrder,
  editOrderControlled,
  editOrderDetails,
  forwardOrder,
  reassignOrder,
  reconcileOrder,
  reopenOrder,
  resumeService,
  startService,
  startTriage,
  updateOrderLinksLegacy,
  waitForInformation,
} from "./actions/orders";
export { uploadAttachment } from "./actions/attachments";
export {
  deactivateProfessionalMembership,
  prepareProfessionalIdentityChange,
  restoreProfessionalIdentity,
  saveCatalog,
  saveMembership,
  saveProfessionalMembership,
  saveUnit,
} from "./actions/administration";
export {
  deleteAccessProfile,
  saveAccessProfile,
  saveAccessProfilePermissions,
} from "./actions/access-profiles";
