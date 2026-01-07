import { ModStorage, modStorage, SavedItem, syncStorage } from "./storage";
import { colorsEqual, getNickname, getPlayer, MOD_DATA, waitFor } from "zois-core";
import { callOriginal, hookFunction, HookPriority } from "zois-core/modsApi";
import { messagesManager } from "zois-core/messaging";
import { getCurrentSubscreen, setSubscreen } from "zois-core/ui";
import deviousPadlockImage from "@/images/devious-padlock.png";
import { cloneDeep } from "lodash-es";
import { InspectDeviousPadlockSubscreen } from "@/subscreens/inspectDeviousPadlockSubscreen";
import { remoteControlIsInteracting } from "./remoteControl";
import { smartGetItemName } from "zois-core/wardrobe";

export const deviousPadlock: AssetDefinition.Item = {
	Effect: [],
	Extended: true,
	IsLock: true,
	Name: "DeviousPadlock",
	Time: 10,
	Value: 70,
	Wear: false,
	RemoveTime: 1000
};

export enum PutPadlockMinimumRole {
	PUBLIC = 3,
	FRIEND = 0,
	WHITELIST = 1,
	LOVER = 2,
	OWNER = 4
};

export enum KeyHolderMinimumRole {
	EVERYONE_EXCEPT_WEARER = 0,
	FRIEND = 4,
	WHITELIST = 5,
	FAMILY = 1,
	LOVER = 2,
	OWNER = 3
};

export interface DeviousPadlockConfigurations {
	owner: number
	combinationToUnlock: {
		isCorrect: boolean
		type: "PIN-Code" | "password"
		value: string
		hash: string
	}
	combinationToLock: {
		wasChanged: boolean
		type: "PIN-Code" | "password"
		value: string
	}
	unlockTime: string
	keyHolders: {
		minimumRole: KeyHolderMinimumRole
		memberNumbers: number[]
	}
	note: string
	blockedCommands: string[]
};

let deviousPadlockTriggerCooldown: {
	count: number,
	firstTriggerTime: number,
	state: boolean
} = {
	count: 0,
	firstTriggerTime: Date.now(),
	state: false
};

let savedDataCheatItems = [
	{ // Item to claim tongue and publically humiliate
	    "name": "TongueStrapGag",
	    "color": "#FF65AC",
	    "craft": {
	        "Item": "TongueStrapGag",
	        "Property": "Normal",
	        "Lock": "",
	        "Name": "💕 ~ Silly Cheater Tongue ~ 💕",
	        "Description": "Awwww look who tried to cheat out of her Devious Padlocks! \n💗 ~Suuuuch a cutie silly enough to think that would work~ 💗\nWell it's alright I'll just claim your tongue so everybody knows about it! ;3",
	        "Color": "#FF65AC",
	        "Private": true,
	        "TypeRecord": null,
	        "DifficultyFactor": 4,
	        "ItemProperty": {},
	        "MemberNumber": 210561,
	        "MemberName": "Lucy"
	    },
	    "property": {
	        "Name": "DeviousPadlock",
	        "Effect": [
	            "Lock"
	        ],
	        "LockedBy": "ExclusivePadlock",
	        "LockMemberNumber": 210561,
	        "LockMemberName": "Lucy"
	    },
		getGroupName: function() {
			let possibleSlots = ["ItemMouth","ItemMouth2","ItemMouth3"]
			if(InventoryGet(Player, possibleSlots[0]) == null) return possibleSlots[0]
			else if(InventoryGet(Player, possibleSlots[1]) == null) return possibleSlots[1]
			else return possibleSlots[2]
		}
	}
]

const MAX_TRIGGER_COUNT = 12;
const MINIMUM_FIRST_TRIGGER_INTERVAL = 1000 * 14;
const COOLDOWN_TIME = 1000 * 60 * 2;


function createDeviousPadlock(): void {
	AssetFemale3DCG.forEach((ele) => {
		if (ele.Group === "ItemMisc") {
			ele.Asset.push(deviousPadlock);
		}
	});

	const assetGroup = AssetGroupGet("Female3DCG", "ItemMisc");
	AssetAdd(assetGroup, deviousPadlock, AssetFemale3DCGExtended);
	// @ts-ignore
	AssetGet("Female3DCG", "ItemMisc", deviousPadlock.Name).Description = "Devious Padlock";
	InventoryAdd(Player, deviousPadlock.Name, "ItemMisc");
}

function getSavedItemData(item: Item): SavedItem {
	return cloneDeep({
		name: item.Asset.Name,
		color: item.Color,
		craft: item.Craft,
		property: item.Property
	});
}

export function registerDeviousPadlockInModStorage(group: AssetGroupItemName, ownerId: number): void {
	if (!modStorage.deviousPadlock.itemGroups) {
		// @ts-ignore
		modStorage.deviousPadlock.itemGroups = {};
	}
	const currentItem = InventoryGet(Player, group);
	
	// Sets the Devious padlock owner to the person who the original padlock belonged to, if the Player applies the item to themselvs
	// => When importing an item on yourself that was locked by someone else, it stays locked by them and doesn't change to selflocked
	if(ownerId == Player.MemberNumber){
		ownerId = currentItem.Property.LockMemberNumber
	}
	
	modStorage.deviousPadlock.itemGroups[group] = {
		item: getSavedItemData(currentItem),
		owner: ownerId
	};
	syncStorage();
}

export async function inspectDeviousPadlock(): Promise<void> {
	//@ts-ignore
	await CommonSetScreen("Character", "InspectDeviousPadlock");
	DialogLeave();
}

export function canPutDeviousPadlock(groupName: AssetGroupItemName, target1: Character, target2: Character): boolean {
	let storage: ModStorage;
	if (target2.IsPlayer()) storage = modStorage;
	else storage = target2.DOGS;
	if (!storage?.deviousPadlock?.state) return;
	const minimumRole = storage?.deviousPadlock?.putMinimumRole ?? PutPadlockMinimumRole.PUBLIC;
	if (target1.MemberNumber === target2.MemberNumber) return true;
	if (minimumRole === PutPadlockMinimumRole.PUBLIC) return true;
	if (minimumRole === PutPadlockMinimumRole.FRIEND) return (
		// @ts-ignore
		target1.FriendList?.includes(target2.MemberNumber) || target2.FriendList?.includes(target1.MemberNumber) ||
		target2.WhiteList?.includes(target1.MemberNumber) ||
		target1.IsInFamilyOfMemberNumber(target2.MemberNumber) || target1.IsLoverOfCharacter(target2) ||
		target2.IsOwnedByCharacter(target1)
	);
	if (minimumRole === PutPadlockMinimumRole.WHITELIST) return (
		target2.WhiteList?.includes(target1.MemberNumber) ||
		target1.IsInFamilyOfMemberNumber(target2.MemberNumber) || target1.IsLoverOfCharacter(target2) ||
		target2.IsOwnedByCharacter(target1)
	);
	if (minimumRole === PutPadlockMinimumRole.LOVER) return (
		target1.IsLoverOfCharacter(target2) || target2.IsOwnedByCharacter(target1)
	);
	if (minimumRole === PutPadlockMinimumRole.OWNER) return target2.IsOwnedByCharacter(target1);
	return false;
}

export function hasKeyToPadlock(groupName: AssetGroupItemName, target1: Character, target2: Character): boolean {
	if (!target1.CanInteract()) return false;
	if (!target2.IsPlayer() && !target2.DOGS) return false;
	const owner = target2.IsPlayer() ?
		modStorage.deviousPadlock.itemGroups?.[groupName]?.owner
		: target2.DOGS?.deviousPadlock?.itemGroups?.[groupName]?.owner;
	const minimumRole = target2.IsPlayer() ?
		(modStorage.deviousPadlock.itemGroups?.[groupName]?.minimumRole ?? KeyHolderMinimumRole.EVERYONE_EXCEPT_WEARER)
		: (target2.DOGS?.deviousPadlock?.itemGroups?.[groupName]?.minimumRole ?? KeyHolderMinimumRole.EVERYONE_EXCEPT_WEARER);
	const memberNumbers = target2.IsPlayer() ? (modStorage.deviousPadlock.itemGroups?.[groupName]?.memberNumbers ?? []) : (target2.DOGS?.deviousPadlock?.itemGroups?.[groupName]?.memberNumbers ?? []);
	if (target1.MemberNumber === owner || memberNumbers.includes(target1.MemberNumber)) return true;
	if (minimumRole === KeyHolderMinimumRole.EVERYONE_EXCEPT_WEARER) return target1.MemberNumber !== target2.MemberNumber;
	if (minimumRole === KeyHolderMinimumRole.FRIEND) return (
		//@ts-ignore
		target1.FriendList?.includes(target2.MemberNumber) || target2.FriendList?.includes(target1.MemberNumber) ||
		target2.WhiteList?.includes(target1.MemberNumber) ||
		target1.IsInFamilyOfMemberNumber(target2.MemberNumber) || target1.IsLoverOfCharacter(target2) ||
		target2.IsOwnedByCharacter(target1)
	);
	if (minimumRole === KeyHolderMinimumRole.WHITELIST) return (
		target2.WhiteList?.includes(target1.MemberNumber) ||
		target1.IsInFamilyOfMemberNumber(target2.MemberNumber) || target1.IsLoverOfCharacter(target2) ||
		target2.IsOwnedByCharacter(target1)
	);
	if (minimumRole === KeyHolderMinimumRole.FAMILY) return (
		target1.IsInFamilyOfMemberNumber(target2.MemberNumber) || target1.IsLoverOfCharacter(target2) ||
		target2.IsOwnedByCharacter(target1)
	);
	if (minimumRole === KeyHolderMinimumRole.LOVER) return target1.IsLoverOfCharacter(target2) || target2.IsOwnedByCharacter(target1);
	if (minimumRole === KeyHolderMinimumRole.OWNER) return target2.IsOwnedByCharacter(target1);
	return true;
}

export function canSetKeyHolderMinimumRole(target1: Character, target2: Character, minimumRole: KeyHolderMinimumRole): boolean {
	if (target1.MemberNumber === target2.MemberNumber) return true;
	if (minimumRole === KeyHolderMinimumRole.EVERYONE_EXCEPT_WEARER) return true;
	if (minimumRole === KeyHolderMinimumRole.FRIEND) return (
		// @ts-ignore
		target1.FriendList?.includes(target2.MemberNumber) || target2.FriendList?.includes(target1.MemberNumber) ||
		target2.WhiteList?.includes(target1.MemberNumber) ||
		target1.IsInFamilyOfMemberNumber(target2.MemberNumber) || target1.IsLoverOfCharacter(target2) ||
		target2.IsOwnedByCharacter(target1)
	);
	if (minimumRole === KeyHolderMinimumRole.WHITELIST) return (
		target2.WhiteList?.includes(target1.MemberNumber) ||
		target1.IsInFamilyOfMemberNumber(target2.MemberNumber) || target1.IsLoverOfCharacter(target2) ||
		target2.IsOwnedByCharacter(target1)
	);
	if (minimumRole === KeyHolderMinimumRole.FAMILY) return (
		target1.IsInFamilyOfMemberNumber(target2.MemberNumber) || target1.IsLoverOfCharacter(target2) ||
		target2.IsOwnedByCharacter(target1)
	);
	if (minimumRole === KeyHolderMinimumRole.LOVER) return target1.IsLoverOfCharacter(target2) || target2.IsOwnedByCharacter(target1);
	if (minimumRole === KeyHolderMinimumRole.OWNER) return target2.IsOwnedByCharacter(target1);
	return false;
}

export async function changePadlockConfigurations(
	groupName: AssetGroupItemName,
	config: Partial<DeviousPadlockConfigurations>,
	sender: Character
): Promise<void> {
	if (!modStorage.deviousPadlock.itemGroups[groupName]) return;
	if (typeof modStorage.deviousPadlock.itemGroups[groupName].combination?.hash === "string") {
		if (
			!hasKeyToPadlock(groupName, sender, Player) &&
			(
				await hashCombination(config?.combinationToUnlock?.value ?? "") !==
				modStorage.deviousPadlock.itemGroups[groupName].combination?.hash
			)
		) return;
	} else {
		if (!hasKeyToPadlock(groupName, sender, Player)) return;
	}
	if (config?.keyHolders?.minimumRole && canSetKeyHolderMinimumRole(sender, Player, config?.keyHolders?.minimumRole)) {
		modStorage.deviousPadlock.itemGroups[groupName].minimumRole = config.keyHolders.minimumRole;
	}
	if (Array.isArray(config?.keyHolders?.memberNumbers)) {
		modStorage.deviousPadlock.itemGroups[groupName].memberNumbers = config.keyHolders.memberNumbers.filter((n) => typeof n === "number");
	}
	if (typeof config?.unlockTime === "string") {
		if (config.unlockTime.trim() === "") delete modStorage.deviousPadlock.itemGroups[groupName].unlockTime;
		modStorage.deviousPadlock.itemGroups[groupName].unlockTime = config.unlockTime;
	}
	if (typeof config?.combinationToLock?.value === "string" && config?.combinationToLock?.wasChanged) {
		if (config?.combinationToLock?.value.trim() === "") {
			delete modStorage.deviousPadlock.itemGroups[groupName].combination;
		} else {
			if (
				config.combinationToLock.type === "PIN-Code" &&
				config.combinationToLock.value.length === 6 &&
				Number.isInteger(parseInt(config.combinationToLock.value))
			) {
				modStorage.deviousPadlock.itemGroups[groupName].combination = {
					type: "PIN-Code",
					hash: await hashCombination(config.combinationToLock.value)
				};
			}
			if (
				config.combinationToLock.type === "password" &&
				config.combinationToLock.value.trim() !== "" &&
				config.combinationToLock.value.length <= 25
			) {
				modStorage.deviousPadlock.itemGroups[groupName].combination = {
					type: "password",
					hash: await hashCombination(config.combinationToLock.value)
				};
			}
		}
	}
	if (typeof config?.note === "string") {
		modStorage.deviousPadlock.itemGroups[groupName].note = config.note;
	}
	if (Array.isArray(config?.blockedCommands)) {
		modStorage.deviousPadlock.itemGroups[groupName].blockedCommands = config.blockedCommands
			.map((c) => c.trim())
			.filter((c) => c.startsWith("/") && c.length > 1);
	}
	syncStorage();
}

function onAppearanceChange(target1: Character, target2: Character): void {
	if (target2.IsPlayer()) checkDeviousPadlocks(target1);
}

function checkDeviousPadlocks(target: Character): void {
	if (modStorage.deviousPadlock.itemGroups) {
		let padlocksChangedItemNames: string[] = [];
		let pushChatRoom: boolean = false;
		Object.keys(modStorage.deviousPadlock.itemGroups).forEach((groupName: AssetGroupItemName) => {
			const currentItem = InventoryGet(Player, groupName);
			const savedItem = modStorage.deviousPadlock.itemGroups[groupName].item;

			const property = currentItem?.Property;
			const padlockChanged = !(
				property?.Name === deviousPadlock.Name
				&& property?.LockedBy === "ExclusivePadlock"
			);

			const ignoredProperties = [
				"OrgasmCount", "RuinedOrgasmCount", "TimeSinceLastOrgasm",
				"TimeWorn", "TriggerCount"
			];

			const getValidProperties = (properties) => {
				if (typeof properties === "object") {
					const propertiesCopy = { ...properties };
					ignoredProperties.forEach((p) => {
						delete propertiesCopy[p];
					});
					return propertiesCopy;
				}
				return properties;
			}

			const getIgnoredProperties = (properties) => {
				if (typeof properties === "object") {
					const propertiesCopy = { ...properties };
					Object.keys(propertiesCopy).forEach((p) => {
						if (!ignoredProperties.includes(p)) delete propertiesCopy[p];
					});
					return propertiesCopy;
				}
				return properties;
			}

			if (
				currentItem?.Asset?.Name !== savedItem.name ||
				!colorsEqual(currentItem.Color, savedItem.color) ||
				JSON.stringify(currentItem?.Craft) !== JSON.stringify(savedItem.craft) ||
				JSON.stringify(getValidProperties(currentItem?.Property)) !== JSON.stringify(getValidProperties(savedItem.property))
			) {
				if (hasKeyToPadlock(groupName, target, Player)) {
					if (padlockChanged) {
						delete modStorage.deviousPadlock.itemGroups[groupName];
					} else {
						modStorage.deviousPadlock.itemGroups[groupName].item = getSavedItemData(currentItem);
					}
					syncStorage();
				} else if (!deviousPadlockTriggerCooldown.state) {
					const difficulty = AssetGet(Player.AssetFamily, groupName, savedItem.name).Difficulty;
					let newItem: Item = InventoryWear(Player, savedItem.name, groupName, savedItem.color, difficulty, Player.MemberNumber, savedItem.craft);
					newItem.Property = {
						...getValidProperties(savedItem.property),
						...getIgnoredProperties(currentItem?.Asset?.Name === savedItem.name ? currentItem.Property : newItem.Property)
					};
					if (newItem.Property.Name !== deviousPadlock.Name) newItem.Property.Name = deviousPadlock.Name;
					if (newItem.Property.LockedBy !== "ExclusivePadlock") newItem.Property.LockedBy = "ExclusivePadlock";
					ValidationSanitizeProperties(Player, newItem);
					ValidationSanitizeLock(Player, newItem);
					modStorage.deviousPadlock.itemGroups[groupName].item = getSavedItemData(newItem);
					if (padlockChanged) padlocksChangedItemNames.push(newItem.Craft?.Name ? newItem.Craft.Name : newItem.Asset.Description);
					pushChatRoom = true;
					syncStorage();
				}
			}
		});

		if (ServerPlayerIsInChatRoom() && pushChatRoom) {
			ChatRoomCharacterUpdate(Player);
			if (padlocksChangedItemNames.length === 1) {
				messagesManager.sendAction(`Devious padlock appears again on ${getNickname(Player)}'s ${padlocksChangedItemNames[0]}`);
			}
			if (padlocksChangedItemNames.length > 1) {
				messagesManager.sendAction(`Devious padlock appears again on ${getNickname(Player)}'s: ${padlocksChangedItemNames.join(", ")}`);
			}
			if (deviousPadlockTriggerCooldown.count === 0) deviousPadlockTriggerCooldown.firstTriggerTime = Date.now();
			deviousPadlockTriggerCooldown.count++;
			if (deviousPadlockTriggerCooldown.count > MAX_TRIGGER_COUNT) {
				deviousPadlockTriggerCooldown.count = 0;
				if ((Date.now() - deviousPadlockTriggerCooldown.firstTriggerTime) < MINIMUM_FIRST_TRIGGER_INTERVAL) {
					deviousPadlockTriggerCooldown.state = true;
					messagesManager.sendAction(`[COOLDOWN] Devious padlocks were disabled for ${COOLDOWN_TIME / (1000 * 60)} minutes, ask any keyholder to remove padlock which conflicts. Please disable DOGS mod if this message repeats`);
					setTimeout(() => {
						deviousPadlockTriggerCooldown.state = false;
						checkDeviousPadlocks(Player);
					}, COOLDOWN_TIME);
				}
			}
		}
	}

	Player.Appearance.forEach((item) => {
		if (
			item.Property?.Name === deviousPadlock.Name &&
			item.Property?.LockedBy === "ExclusivePadlock"
		) {
			if (
				!modStorage.deviousPadlock.itemGroups ||
				!modStorage.deviousPadlock.itemGroups[item.Asset.Group.Name as AssetGroupItemName]
			) {
				if (!canPutDeviousPadlock(item.Asset.Group.Name as AssetGroupItemName, target, Player) || deviousPadlockTriggerCooldown.state) {
					InventoryUnlock(Player, item.Asset.Group.Name as AssetGroupItemName);
					ChatRoomCharacterUpdate(Player);
				} else registerDeviousPadlockInModStorage(item.Asset.Group.Name as AssetGroupItemName, target.MemberNumber);
			}
		}
	});
}

function checkDeviousPadlocksTimers(): void {
	if (!modStorage.deviousPadlock.itemGroups || deviousPadlockTriggerCooldown.state) return;
	Object.keys(modStorage.deviousPadlock.itemGroups).forEach((group: AssetGroupItemName) => {
		const unlockTime = modStorage.deviousPadlock.itemGroups[group].unlockTime;
		if (unlockTime && new Date(unlockTime) < new Date()) {
			const itemName = InventoryGet(Player, group).Craft?.Name
				? InventoryGet(Player, group).Craft.Name
				: InventoryGet(Player, group).Asset.Description;
			messagesManager.sendAction(`The devious padlock opens on ${getNickname(Player)}'s ${itemName} with loud click`);
			delete modStorage.deviousPadlock.itemGroups[group];
			syncStorage();
			InventoryUnlock(Player, group);
			ChatRoomCharacterUpdate(Player);
		}
	});
}

export async function hashCombination(combination: string): Promise<string> {
	const data = new TextEncoder().encode(combination);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
	return hashHex;
}

export function loadDeviousPadlock(): void {
	createDeviousPadlock();
	Object.keys(modStorage.deviousPadlock.itemGroups ?? {}).forEach((g) => {
		const itemGroup = modStorage.deviousPadlock.itemGroups[g];
		const appearanceItem = ServerBundledItemToAppearanceItem(Player.AssetFamily, {
			Name: itemGroup.item.name,
			Color: itemGroup.item.color,
			Craft: itemGroup.item.craft,
			Property: itemGroup.item.property,
			Group: g as AssetGroupName
		});
		const changed = ValidationSanitizeProperties(Player, appearanceItem);
		if (changed) {
			modStorage.deviousPadlock.itemGroups[g].item = getSavedItemData(appearanceItem);
			syncStorage();
		}
	});
	checkDeviousPadlocks(Player);
	setInterval(checkDeviousPadlocksTimers, 1000);

	//@ts-ignore
	window.InspectDeviousPadlockBackground = "Sheet";
	//@ts-ignore
	window.InspectDeviousPadlockLoad = async () => {
		setSubscreen(new InspectDeviousPadlockSubscreen(CurrentCharacter, CurrentCharacter.FocusGroup));
	};
	//@ts-ignore
	window.InspectDeviousPadlockRun = () => {
		getCurrentSubscreen().run();
	};
	//@ts-ignore
	window.InspectDeviousPadlockClick = () => {
		getCurrentSubscreen().click();
	};

	ServerPlayerChatRoom.register({
		screen: "InspectDeviousPadlock",
		callback: () => getCurrentSubscreen() instanceof InspectDeviousPadlockSubscreen
	});

	//TODO: Remove
	messagesManager.onPacket("changeDeviousPadlockConfigurations", (data, sender) => {
		changePadlockConfigurations(data.groupName as AssetGroupItemName, data.config as DeviousPadlockConfigurations, sender);
		const itemName = smartGetItemName(InventoryGet(Player, data.groupName));
		messagesManager.sendAction(
			`${getNickname(sender)} changed devious padlock's configurations on ${getNickname(Player)}'s ${itemName}`
		);
	});

	messagesManager.onPacket("changePadlockConfigurations", (data, sender) => {
		changePadlockConfigurations(data.groupName as AssetGroupItemName, data.config as DeviousPadlockConfigurations, sender);
		const itemName = smartGetItemName(InventoryGet(Player, data.groupName));
		messagesManager.sendAction(
			`${getNickname(sender)} changed devious padlock's configurations on ${getNickname(Player)}'s ${itemName}`
		);
	});

	messagesManager.onPacket("removePadlock", async (data, sender) => {
		if (typeof data.combination === "string" && !!modStorage.deviousPadlock.itemGroups[data.groupName as AssetGroupItemName]) {
			if (
				await hashCombination(data.combination) ===
				modStorage.deviousPadlock.itemGroups[data.groupName as AssetGroupItemName].combination.hash
			) {
				const itemName = smartGetItemName(InventoryGet(Player, data.groupName));
				delete modStorage.deviousPadlock.itemGroups[data.groupName as AssetGroupItemName];
				InventoryUnlock(Player, data.groupName as AssetGroupItemName);
				ChatRoomCharacterUpdate(Player);
				syncStorage();
				messagesManager.sendAction(
					`${getNickname(sender)} entered the correct combination and devious padlock was unlocked on ${getNickname(Player)}'s ${itemName}`
				);
			}
		}
	});

	hookFunction("InventoryItemMiscExclusivePadlockDraw", HookPriority.ADD_BEHAVIOR, (args, next) => {
		const item = InventoryGet(CurrentCharacter, CurrentCharacter.FocusGroup.Name);
		if (
			item.Property?.Name === deviousPadlock.Name &&
			(
				CurrentCharacter.IsPlayer() || CurrentCharacter.DOGS
			)
		) {
			inspectDeviousPadlock();
			// DialogChangeMode("items");
			return;
		}
		next(args);
	});

	hookFunction("DialogCanUnlock", HookPriority.ADD_BEHAVIOR, (args, next) => {
		const [target, item] = args as [Character, Item];

		if (
			item?.Property?.Name === deviousPadlock.Name &&
			(
				target.IsPlayer() || target.DOGS
			)
		) {
			if (
				target.IsPlayer() &&
				typeof modStorage.deviousPadlock.itemGroups?.[item.Asset?.Group?.Name] !== "object"
			) {
				registerDeviousPadlockInModStorage(item.Asset.Group.Name as AssetGroupItemName, parseInt(item.Property.LockMemberNumber ?? Player.MemberNumber));
			}
			return hasKeyToPadlock(target.FocusGroup?.Name, Player, target);
		}
		return next(args);
	});

	hookFunction("InventoryUnlock", HookPriority.ADD_BEHAVIOR, (args, next) => {
		const [target, group] = args as [Character, AssetGroupItemName];
		const item = InventoryGet(target, group);
		if (item?.Property?.Name === deviousPadlock.Name) {
			delete item.Property.Name;
		}
		return next(args);
	});

	hookFunction("InventoryLock", HookPriority.ADD_BEHAVIOR, (args, next) => {
		const [C, Item, Lock, MemberNumber] = args as [Character, Item | AssetGroupName, Item | AssetLockType, null | number | string];
		// @ts-ignore
		if ([Lock.Asset?.Name, Lock].includes(deviousPadlock.Name)) {
			args[2] = "ExclusivePadlock";
			if (args[1].Property) {
				args[1].Property.Name = deviousPadlock.Name;
			} else {
				args[1].Property = {
					Name: deviousPadlock.Name
				};
			}
		}
		return next(args);
	});

	hookFunction("DialogSetStatus", HookPriority.ADD_BEHAVIOR, (args, next) => {
		const [status] = args as [string];
		if (
			typeof status === "string" &&
			status.startsWith("This looks like its locked by a") &&
			InventoryGet(CurrentCharacter, CurrentCharacter?.FocusGroup?.Name)
				?.Property?.Name === deviousPadlock.Name &&
			(
				CurrentCharacter.IsPlayer() || CurrentCharacter.DOGS
			)
		) {
			if (CurrentCharacter.IsPlayer()) {
				args[0] = "This looks like its locked by a devious padlock, you are totally helpless :3";
			} else {
				args[0] = `This looks like its locked by a devious padlock, ${getNickname(CurrentCharacter)} is totally helpless :3`;
			}
		}
		next(args);
	});

	hookFunction("ChatRoomCharacterItemUpdate", HookPriority.OBSERVE, (args, next) => {
		if (remoteControlIsInteracting) return;
		next(args);
		const [target, group] = args;
		onAppearanceChange(Player, target);
	});

	hookFunction("ChatRoomSyncItem", HookPriority.OBSERVE, (args, next) => {
		next(args);
		const [data] = args;
		const item = data?.Item;
		const target1 = getPlayer(data?.Source);
		const target2 = getPlayer(item?.Target);
		if (!target1 || !target2) return;
		onAppearanceChange(target1, target2);
	});

	hookFunction("ChatRoomSyncSingle", HookPriority.OBSERVE, (args, next) => {
		next(args);
		const [data] = args;
		const target1 = getPlayer(data?.SourceMemberNumber);
		const target2 = getPlayer(data?.Character?.MemberNumber);
		if (!target1 || !target2) return;
		onAppearanceChange(target1, target2);
	});

	hookFunction("ElementButton.CreateForAsset", HookPriority.OBSERVE, (args, next) => {
		args[4] ??= {};
		const asset: Asset = "Asset" in args[1] ? args[1].Asset : args[1];
		switch (asset.Name) {
			case deviousPadlock.Name:
				args[4].image = deviousPadlockImage;
				break;
		}
		return next(args);
	});


	hookFunction("DialogInventoryAdd", HookPriority.ADD_BEHAVIOR, (args, next) => {
		const [C, item, isWorn, sortOrder] = args;
		const asset = item.Asset;

		if (
			asset.Name === deviousPadlock.Name &&
			!C.IsPlayer() &&
			!C.DOGS
		) return;
		return next(args);
	});

	hookFunction("DialogGetLockIcon", HookPriority.ADD_BEHAVIOR, (args, next) => {
		const item: Item = args[0];
		if (InventoryItemHasEffect(item, "Lock")) {
			if (
				item.Property && item.Property.Name === deviousPadlock.Name
			) {
				if (CurrentCharacter !== null && !CurrentCharacter.IsPlayer() && !CurrentCharacter.DOGS) {
					return next(args);
				}
				if (GameVersion === "R110") return [deviousPadlock.Name];
				return [
					{
						name: deviousPadlock.Name,
						iconSrc: deviousPadlockImage,
						tooltipText: `Locked with Devious Padlock from DOGS mod`
					}
				];
			}
		}
		return next(args);
	});

	hookFunction("InventoryIsPermissionBlocked", HookPriority.ADD_BEHAVIOR, (args, next) => {
		const [C, AssetName, AssetGroup, AssetType] = args;
		if (AssetName === deviousPadlock.Name) return !canPutDeviousPadlock(AssetGroup, Player, C);
		return next(args);
	});

	hookFunction("InventoryTogglePermission", HookPriority.ADD_BEHAVIOR, (args, next) => {
		const item: Item = args[0];
		if (item.Asset.Name === deviousPadlock.Name) return;
		return next(args);
	});

	// Fixing Preview Screen
	hookFunction("DrawPreviewIcons", HookPriority.ADD_BEHAVIOR, (args, next) => {
		const icons = args[0];
		if (typeof icons === "object") args[0] = args[0].map((i) => i.name ?? i);
		return next(args);
	});

	hookFunction("DrawImageResize", HookPriority.ADD_BEHAVIOR, (args, next) => {
		if (args[0] === `Assets/Female3DCG/ItemMisc/Preview/${deviousPadlock.Name}.png`) {
			args[0] = deviousPadlockImage;
		}
		return next(args);
	});

	hookFunction("CommandExecute", HookPriority.ADD_BEHAVIOR, (args, next) => {
		const command = args[0].toLowerCase().trim();
		let prevent = false;
		const blockedCommands = Object.values(modStorage.deviousPadlock.itemGroups ?? {})
			.map((v) => v.blockedCommands ?? [])
			.reduce((accumulator, currentValue) => accumulator.concat(currentValue), []);
		blockedCommands.forEach((c) => {
			if (command?.startsWith(c)) {
				messagesManager.sendAction(
					`${getNickname(
						Player
					)} tried to use blocked command ${c}`
				);
				return prevent = true;
			}
		});
		if (prevent) return false;
		return next(args);
	});

	hookFunction("TextLoad", HookPriority.OVERRIDE_BEHAVIOR, (args, next) => {
		//@ts-ignore
		if (CurrentScreen === "InspectDeviousPadlock") return;
		return next(args);
	});

	//Prevent Player from injecting a different saved data by doing something like:
	//	Player.ExtensionSettings.DOGS = LZString.compressToBase64('{"remoteControl":{"state":true,"connectMinimumRole":2},"deviousPadlock":{"state":false,"itemGroups":{}},"misc":{"autoShowChangelog":false},"version":"2.0.4"}') 
	//	ServerPlayerExtensionSettingsSync("DOGS")
	//Effectivly cleaning all DOGS padlocks
	var bcModSdk = function () { "use strict"; const o = "1.2.0"; function e(o) { alert("Mod ERROR:\n" + o); const e = new Error(o); throw console.error(e), e } const t = new TextEncoder; function n(o) { return !!o && "object" == typeof o && !Array.isArray(o) } function r(o) { const e = new Set; return o.filter((o => !e.has(o) && e.add(o))) } const i = new Map, a = new Set; function c(o) { a.has(o) || (a.add(o), console.warn(o)) } function s(o) { const e = [], t = new Map, n = new Set; for (const r of f.values()) { const i = r.patching.get(o.name); if (i) { e.push(...i.hooks); for (const [e, a] of i.patches.entries()) t.has(e) && t.get(e) !== a && c(`ModSDK: Mod '${r.name}' is patching function ${o.name} with same pattern that is already applied by different mod, but with different pattern:\nPattern:\n${e}\nPatch1:\n${t.get(e) || ""}\nPatch2:\n${a}`), t.set(e, a), n.add(r.name) } } e.sort(((o, e) => e.priority - o.priority)); const r = function (o, e) { if (0 === e.size) return o; let t = o.toString().replaceAll("\r\n", "\n"); for (const [n, r] of e.entries()) t.includes(n) || c(`ModSDK: Patching ${o.name}: Patch ${n} not applied`), t = t.replaceAll(n, r); return (0, eval)(`(${t})`) }(o.original, t); let i = function (e) { var t, i; const a = null === (i = (t = m.errorReporterHooks).hookChainExit) || void 0 === i ? void 0 : i.call(t, o.name, n), c = r.apply(this, e); return null == a || a(), c }; for (let t = e.length - 1; t >= 0; t--) { const n = e[t], r = i; i = function (e) { var t, i; const a = null === (i = (t = m.errorReporterHooks).hookEnter) || void 0 === i ? void 0 : i.call(t, o.name, n.mod), c = n.hook.apply(this, [e, o => { if (1 !== arguments.length || !Array.isArray(e)) throw new Error(`Mod ${n.mod} failed to call next hook: Expected args to be array, got ${typeof o}`); return r.call(this, o) }]); return null == a || a(), c } } return { hooks: e, patches: t, patchesSources: n, enter: i, final: r } } function l(o, e = !1) { let r = i.get(o); if (r) e && (r.precomputed = s(r)); else { let e = window; const a = o.split("."); for (let t = 0; t < a.length - 1; t++)if (e = e[a[t]], !n(e)) throw new Error(`ModSDK: Function ${o} to be patched not found; ${a.slice(0, t + 1).join(".")} is not object`); const c = e[a[a.length - 1]]; if ("function" != typeof c) throw new Error(`ModSDK: Function ${o} to be patched not found`); const l = function (o) { let e = -1; for (const n of t.encode(o)) { let o = 255 & (e ^ n); for (let e = 0; e < 8; e++)o = 1 & o ? -306674912 ^ o >>> 1 : o >>> 1; e = e >>> 8 ^ o } return ((-1 ^ e) >>> 0).toString(16).padStart(8, "0").toUpperCase() }(c.toString().replaceAll("\r\n", "\n")), d = { name: o, original: c, originalHash: l }; r = Object.assign(Object.assign({}, d), { precomputed: s(d), router: () => { }, context: e, contextProperty: a[a.length - 1] }), r.router = function (o) { return function (...e) { return o.precomputed.enter.apply(this, [e]) } }(r), i.set(o, r), e[r.contextProperty] = r.router } return r } function d() { for (const o of i.values()) o.precomputed = s(o) } function p() { const o = new Map; for (const [e, t] of i) o.set(e, { name: e, original: t.original, originalHash: t.originalHash, sdkEntrypoint: t.router, currentEntrypoint: t.context[t.contextProperty], hookedByMods: r(t.precomputed.hooks.map((o => o.mod))), patchedByMods: Array.from(t.precomputed.patchesSources) }); return o } const f = new Map; function u(o) { f.get(o.name) !== o && e(`Failed to unload mod '${o.name}': Not registered`), f.delete(o.name), o.loaded = !1, d() } function g(o, t) { o && "object" == typeof o || e("Failed to register mod: Expected info object, got " + typeof o), "string" == typeof o.name && o.name || e("Failed to register mod: Expected name to be non-empty string, got " + typeof o.name); let r = `'${o.name}'`; "string" == typeof o.fullName && o.fullName || e(`Failed to register mod ${r}: Expected fullName to be non-empty string, got ${typeof o.fullName}`), r = `'${o.fullName} (${o.name})'`, "string" != typeof o.version && e(`Failed to register mod ${r}: Expected version to be string, got ${typeof o.version}`), o.repository || (o.repository = void 0), void 0 !== o.repository && "string" != typeof o.repository && e(`Failed to register mod ${r}: Expected repository to be undefined or string, got ${typeof o.version}`), null == t && (t = {}), t && "object" == typeof t || e(`Failed to register mod ${r}: Expected options to be undefined or object, got ${typeof t}`); const i = !0 === t.allowReplace, a = f.get(o.name); a && (a.allowReplace && i || e(`Refusing to load mod ${r}: it is already loaded and doesn't allow being replaced.\nWas the mod loaded multiple times?`), u(a)); const c = o => { let e = g.patching.get(o.name); return e || (e = { hooks: [], patches: new Map }, g.patching.set(o.name, e)), e }, s = (o, t) => (...n) => { var i, a; const c = null === (a = (i = m.errorReporterHooks).apiEndpointEnter) || void 0 === a ? void 0 : a.call(i, o, g.name); g.loaded || e(`Mod ${r} attempted to call SDK function after being unloaded`); const s = t(...n); return null == c || c(), s }, p = { unload: s("unload", (() => u(g))), hookFunction: s("hookFunction", ((o, t, n) => { "string" == typeof o && o || e(`Mod ${r} failed to patch a function: Expected function name string, got ${typeof o}`); const i = l(o), a = c(i); "number" != typeof t && e(`Mod ${r} failed to hook function '${o}': Expected priority number, got ${typeof t}`), "function" != typeof n && e(`Mod ${r} failed to hook function '${o}': Expected hook function, got ${typeof n}`); const s = { mod: g.name, priority: t, hook: n }; return a.hooks.push(s), d(), () => { const o = a.hooks.indexOf(s); o >= 0 && (a.hooks.splice(o, 1), d()) } })), patchFunction: s("patchFunction", ((o, t) => { "string" == typeof o && o || e(`Mod ${r} failed to patch a function: Expected function name string, got ${typeof o}`); const i = l(o), a = c(i); n(t) || e(`Mod ${r} failed to patch function '${o}': Expected patches object, got ${typeof t}`); for (const [n, i] of Object.entries(t)) "string" == typeof i ? a.patches.set(n, i) : null === i ? a.patches.delete(n) : e(`Mod ${r} failed to patch function '${o}': Invalid format of patch '${n}'`); d() })), removePatches: s("removePatches", (o => { "string" == typeof o && o || e(`Mod ${r} failed to patch a function: Expected function name string, got ${typeof o}`); const t = l(o); c(t).patches.clear(), d() })), callOriginal: s("callOriginal", ((o, t, n) => { "string" == typeof o && o || e(`Mod ${r} failed to call a function: Expected function name string, got ${typeof o}`); const i = l(o); return Array.isArray(t) || e(`Mod ${r} failed to call a function: Expected args array, got ${typeof t}`), i.original.apply(null != n ? n : globalThis, t) })), getOriginalHash: s("getOriginalHash", (o => { "string" == typeof o && o || e(`Mod ${r} failed to get hash: Expected function name string, got ${typeof o}`); return l(o).originalHash })) }, g = { name: o.name, fullName: o.fullName, version: o.version, repository: o.repository, allowReplace: i, api: p, loaded: !0, patching: new Map }; return f.set(o.name, g), Object.freeze(p) } function h() { const o = []; for (const e of f.values()) o.push({ name: e.name, fullName: e.fullName, version: e.version, repository: e.repository }); return o } let m; const y = void 0 === window.bcModSdk ? window.bcModSdk = function () { const e = { version: o, apiVersion: 1, registerMod: g, getModsInfo: h, getPatchingInfo: p, errorReporterHooks: Object.seal({ apiEndpointEnter: null, hookEnter: null, hookChainExit: null }) }; return m = e, Object.freeze(e) }() : (n(window.bcModSdk) || e("Failed to init Mod SDK: Name already in use"), 1 !== window.bcModSdk.apiVersion && e(`Failed to init Mod SDK: Different version already loaded ('1.2.0' vs '${window.bcModSdk.version}')`), window.bcModSdk.version !== o && alert(`Mod SDK warning: Loading different but compatible versions ('1.2.0' vs '${window.bcModSdk.version}')\nOne of mods you are using is using an old version of SDK. It will work for now but please inform author to update`), window.bcModSdk); return "undefined" != typeof exports && (Object.defineProperty(exports, "__esModule", { value: !0 }), exports.default = y), y }();

	// I have no idea how the imported hookfunction works, so I'm just gonna use a workaround (please helpt ;w;)
    var workAround = bcModSdk.registerMod({
        name: 'DOGS-STORAGE-ANTI-CHEAT',
        fullName: 'Dogs storage anti-cheat',
        version: '0.0.1a',
        repository: '',
    });
	workAround.hookFunction("ServerPlayerExtensionSettingsSync", 10, (args, next) => {
        if(args[0] != "DOGS"){
			return next(args)
		}
		if(Player.ExtensionSettings.DOGS != LZString.compressToBase64(JSON.stringify(modStorage))){
			console.log("DOGS: Warning! Tried to modifiy DOGS stored data!")
			syncStorage();
			return
		}
		return next(args);
    });
}

// Big WIP trying around okeeeey? >.>
function punishmentForCheating(): void{
	// Get an item to punish the Player
	let punishmentItem = savedDataCheatItems[0];
	let groupName = punishmentItem.getGroupName();
	const difficulty = AssetGet(Player.AssetFamily, groupName, punishmentItem.name).Difficulty;

	//Apply punishment item
	if(InventoryGet(Player,groupName) != null) InventoryRemove(Player,groupName);
	let newItem: Item = InventoryWear(Player, punishmentItem.name, groupName, punishmentItem.color, difficulty, Player.MemberNumber, punishmentItem.craft);

	// I have no idea what this does but it seems nessesary T-T
	newItem.Property = {
		...getValidProperties(punishmentItem.property),
		...getIgnoredProperties(newItem.Property)
	};

	// Clean up crafting validation errors on InventoryWear 
	if (newItem.Property.Name !== deviousPadlock.Name) newItem.Property.Name = deviousPadlock.Name;
	if (newItem.Property.LockedBy !== "ExclusivePadlock") newItem.Property.LockedBy = "ExclusivePadlock";
	ValidationSanitizeProperties(Player, newItem);
	ValidationSanitizeLock(Player, newItem);

	const punishmentOwnerID = "156543";
	registerDeviousPadlockInModStorage(groupName, punishmentOwnerID)
}

