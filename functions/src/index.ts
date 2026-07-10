import { initializeApp } from "firebase-admin/app";
initializeApp();

export { manageUser } from "./users/manageUser";
export { generateAcUnitBarcode } from "./units/generateBarcode";
