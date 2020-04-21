/**
 *                  WHITEBOPHIR SERVER
 *********************************************************
 * @licstart  The following is the entire license notice for the 
 *  JavaScript code in this page.
 *
 * Copyright (C) 2013-2014  Ophir LOJKINE
 *
 *
 * The JavaScript code in this page is free software: you can
 * redistribute it and/or modify it under the terms of the GNU
 * General Public License (GNU GPL) as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option)
 * any later version.  The code is distributed WITHOUT ANY WARRANTY;
 * without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE.  See the GNU GPL for more details.
 *
 * As additional permission under GNU GPL version 3 section 7, you
 * may distribute non-source (e.g., minimized or compacted) forms of
 * that code without the copy of the GNU GPL normally required by
 * section 4, provided you include this license notice and a URL
 * through which recipients can access the Corresponding Source.
 *
 * @licend
 * @module boardData
 */

var fs = require('fs'),
	path = require("path");

/** @constant
    @type {string}
    @default
    Path to the file where boards will be saved by default
*/
var HISTORY_DIR = path.join(__dirname, "../server-data/");

/** @constant
    @type {Number}
    @default
    Number of seconds of inactivity after which the board should be saved to a file
*/
var SAVE = false;
var SAVE_INTERVAL = 1000 * 2; // Save after 2 seconds of inactivity
var MAX_SAVE_DELAY = 1000 * 60; // Save after 60 seconds even if there is still activity
var MAX_ITEM_COUNT = 32768; // Max number of items to keep in the board
var MAX_CHILDREN = 12800; // Max number of subitems in an item
var MAX_BOARD_SIZE = 65536; // Maximum value for any x or y on the board

/**
 * Represents a board.
 * @constructor
 */
var BoardData = function (name) {
	this.name = name;
	this.board = {};
	this.file = path.join(HISTORY_DIR, "board-" + encodeURIComponent(name) + ".json");
	this.lastSaveDate = Date.now();
	this.actionHistory = [];
	this.undoHistory = [];
	this.actionHistory.push = function (){
		if (this.length >= 25) {
			this.shift();
		}
		return Array.prototype.push.apply(this,arguments);
	}
	this.userState = {};
	this.users = new Set();
};


/** Adds data to the board */
BoardData.prototype.set = function (id, data) {
	//KISS
	this.board[id] = data;
	this.actionHistory.push({type:'A',data:data});
	this.undoHistory = [];
	this.formatAndSave(data,true);
};

/** Adds a child to an element that is already in the board
 * @param {string} parentId - Identifier of the parent element.
 * @param {object} child - Object containing the the values to update.
 * @returns {boolean} - True if the child was added, else false
*/
BoardData.prototype.addChild = function (parentId, child) {
	var data = this.board[parentId];
	if (typeof data !== "object"){
		return;
	}
	if (Array.isArray(data._children)) data._children.push(child);
	else data._children = [child];
	this.formatAndSave(data,(data.type != "erase"));
};

/** Update the data in the board
 * @param {string} id - Identifier of the data to update.
 * @param {object} newData - Object containing the the values to update.
 * @param {boolean} create - True if the object should be created if it's not currently in the DB.
*/
BoardData.prototype.update = function (id, newData, create) {
	
	if(Array.isArray(id)){
		var save = false;
		var oldTransform = [];
		for(var i = 0;i<id.length;i++){
			var data = this.board[id[i]];
			if (typeof data == "object"){
				save=true;
				oldTransform[i]=data["transform"];
			}
		}
		if(save){
			this.updateActionListTransform(id,newData,oldTransform);
			for(var i = 0;i<id.length;i++){
				var data = this.board[id[i]];
				if (typeof data == "object"){
					data["transform"] = newData.transform[i];
				}
			}
			this.formatAndSave(data,true)
		}
	}else{
		var data = this.board[id];
		if (typeof data !== "object"){
			return;
		}
		if(newData["transform"]){
			this.updateActionListTransform(id,newData,data["transform"]);
		}
		for (var i in newData) {
			if(i!="tool")
			data[i] = newData[i];
			
		}
		this.formatAndSave(data,true);
	}

};

/** Update group transform
 * @param {string} id - Identifier of the data to delete.
 */
BoardData.prototype.updateActionListTransform = function (id,newData,oldTransform) {
	var lastEvent = null
	for(var i = 0;i<this.actionHistory.length;i++){
		if(this.actionHistory[i].gid&&this.actionHistory[i].gid==newData.gid){
			lastEvent=this.actionHistory[i];
			this.actionHistory.splice(i, 1);
    		this.actionHistory.push(lastEvent);
		}
	}
	if(lastEvent){
		lastEvent.transform=newData["transform"]
	}else{
		this.actionHistory.push({type:'U',id:id,gid:newData.gid,tranform:newData["transform"],oldTransform:oldTransform});
		this.undoHistory = [];
	}	
};

/** Removes data from the board
 * @param {string} id - Identifier of the data to delete.
 */
BoardData.prototype.delete = function (id,data) {
	//KISS
	if(Array.isArray(id)){
		var removed = [];
		for(var i = 0;i<id.length;i++){
			if(this.board[id[i]]){
				removed.push(this.board[id[i]]);
				delete this.board[id[i]];
			}
		}
		if(removed.length>0){
			this.actionHistory.push({type:'BR',data:removed});
			this.undoHistory = [];
			this.delaySave();
		}
	}else{
		if(this.board[id]){
			this.actionHistory.push({type:'R',data:this.board[id]});
			this.undoHistory = [];
			delete this.board[id];
			this.delaySave();
		}
	}
};

/** Clears the board
 * @param none
 */
BoardData.prototype.clear = function () {
	//KISS
	if(Object.keys(this.board).length === 0){
		return 0;
	}else{
		this.actionHistory.push({type:'C',data:this.board});
		this.undoHistory = [];
		this.board={};
		this.delaySave();
		return 1;
	}
};

/** Undo 
 * @param none
 */
BoardData.prototype.undo = function () {
	//KISS
	if(this.actionHistory.length>0){
		var lastEvent = this.actionHistory.pop();
		this.undoHistory.push(lastEvent);
		switch(lastEvent.type){
			case "C":
				//for(id in lastEvent.data){
					this.board=lastEvent.data;
				//}
				break;
			case "R":
				this.board[lastEvent.data.id]=lastEvent.data;
				break;
			case "A":
				delete this.board[lastEvent.data.id];
				break;
			case "BR":
				for(var i = 0;i<lastEvent.data.length;i++){
					this.board[lastEvent.data[i].id]=lastEvent.data[i];
				}
				break;
			case "U":
				if(Array.isArray(lastEvent.id)){
					for(var i = 0;i<lastEvent.id.length;i++){
						var data = this.board[lastEvent.id[i]];
						if (typeof data == "object"){
							data.transform=lastEvent.oldTransform[i];
							if(!data.transform){
								delete this.board[lastEvent.id[i]]["transform"]
							}
						}
					}
				}else{
					if(lastEvent.oldTransform){
						this.board[lastEvent.id]["transform"]=lastEvent.oldTransform;
					}else{
						delete this.board[lastEvent.id]["transform"];
					}
				}
				break;
			default:
				break;
		}
			this.delaySave();
			return 1;
	}
	return 0;
};

/** Redo 
 * @param none
 */
BoardData.prototype.redo = function () {
	//KISS
	if(this.undoHistory.length>0){
		var lastEvent = this.undoHistory.pop();
		this.actionHistory.push(lastEvent);
		switch(lastEvent.type){
			case "C":
				//for(id in lastEvent.data){
					this.board = {};
				//}
				break;
			case "A":
				this.board[lastEvent.data.id]=lastEvent.data;
				break;
			case "R":
				delete this.board[lastEvent.data.id];
				break;
			case "BR":
				for(var i = 0;i<lastEvent.data.length;i++){
					delete this.board[lastEvent.data[i].id];
				}
				break;
			case "U":
				if(Array.isArray(lastEvent.id)){
					for(var i = 0;i<lastEvent.id.length;i++){
						var data = this.board[lastEvent.id[i]];
						if (typeof data == "object"){
							data.transform=lastEvent.transform[i];
						}
					}
				}else{
					
					this.board[lastEvent.id]["transform"]=lastEvent.transform;
					
				}
				break;
			default:
				break;
		}
		this.delaySave();
		return 1;
	}
	return 0;
};

BoardData.prototype.formatAndSave = function(data,stamp){
	this.validate(data);
	if(stamp)
	data.time = Date.now();
	this.delaySave();
};

BoardData.prototype.updateActionHistory= function(id){
	var found = 0;
	for(var i =this.actionHistory.length-1; i >=0; i--){ 
		if ( this.actionHistory[i].type == 'A' && this.actionHistory[i].data.id == id) { 
			found=1;
			if(i!=this.actionHistory.length-1)
				this.actionHistory.push(this.actionHistory.splice(i, 1));
			break;
		}
	}
	if(!found)
		this.actionHistory.push({type:'A',data:data});
};

/**updateMsgCount
 * @param {string} id - Identifier of the socket id.
 */
BoardData.prototype.updateMsgCount = function (id) {
	//KISS
	if(!this.userState[id]){
		this.userState[id]={};
		this.userState[id].msgCount=1;
	}else{
		this.userState[id].msgCount++;
	}
};

/**getMsgCount
 * @param {string} id - Identifier of the socket id.
 */
BoardData.prototype.getMsgCount = function (id) {
	//KISS
	if(this.userState[id]&&this.userState[id].msgCount)
		return this.userState[id].msgCount;
	return 0;
};

/** Reads data from the board
 * @param {string} id - Identifier of the element to get.
 * @returns {object} The element with the given id, or undefined if no element has this id
 */
BoardData.prototype.get = function (id, children) {
	return this.board[id];
};

/** Reads data from the board
 * @param {string} [id] - Identifier of the first element to get.
 * @param {BoardData~processData} callback - Function to be called with each piece of data read
 */
BoardData.prototype.getAll = function (id) {
	var results = [];
	var board = this.board;
	var ids = Object.keys(board);
	var sorted = ids.sort(function (x, y) {
		return (board[x].time | 0) - (board[y].time | 0);
	})
	for (var i = 0; i < sorted.length; i++) results.push(board[sorted[i]]);
	return results;
};

/**
 * 
 */
BoardData.prototype.addUser = function addUser(userId) {

}

/**
 * This callback is displayed as part of the BoardData class.
 * Describes a function that processes data that comes from the board
 * @callback BoardData~processData
 * @param {object} data
 */


/** Delays the triggering of auto-save by SAVE_INTERVAL seconds
*/
BoardData.prototype.delaySave = function (file) {
	if (this.saveTimeoutId !== undefined) clearTimeout(this.saveTimeoutId);
	this.saveTimeoutId = setTimeout(this.save.bind(this), SAVE_INTERVAL);
	if (Date.now() - this.lastSaveDate > MAX_SAVE_DELAY) setTimeout(this.save.bind(this), 0);
};

/** Saves the data in the board to a file.
 * @param {string} [file=this.file] - Path to the file where the board data will be saved.
*/
BoardData.prototype.save = function (file) {
	this.lastSaveDate = Date.now();
	this.clean();
	if(SAVE){
		if (!file) file = this.file;
		var board_txt = JSON.stringify(this.board);
		var that = this;
		fs.writeFile(file, board_txt, function onBoardSaved(err) {
			if (err) {
				console.trace(new Error("Unable to save the board: " + err));
			} else {
				console.log("Successfully saved board: " + that.name);
			}
		})
	}
};

/** Remove old elements from the board */
BoardData.prototype.clean = function cleanBoard() {
	var board = this.board;
	var ids = Object.keys(board);
	if (ids.length > MAX_ITEM_COUNT) {
		var toDestroy = ids.sort(function (x, y) {
			return (board[x].time | 0) - (board[y].time | 0);
		}).slice(0, -MAX_ITEM_COUNT);
		for (var i = 0; i < toDestroy.length; i++) delete board[toDestroy[i]];
		console.log("Cleaned " + toDestroy.length + " items in " + this.name);
	}
}

/** Reformats an item if necessary in order to make it follow the boards' policy 
 * @param {object} item The object to edit
 * @param {object} parent The parent of the object to edit
*/
BoardData.prototype.validate = function validate(item, parent) {
	if (item.hasOwnProperty("size")) {
		item.size = parseInt(item.size) || 1;
		item.size = Math.min(Math.max(item.size, 1), 50);
	}
	if (item.hasOwnProperty("x") || item.hasOwnProperty("y")) {
		item.x = parseFloat(item.x) || 0;
		item.x = Math.min(Math.max(item.x, 0), MAX_BOARD_SIZE);
		item.x = Math.round(10 * item.x) / 10;
		item.y = parseFloat(item.y) || 0;
		item.y = Math.min(Math.max(item.y, 0), MAX_BOARD_SIZE);
		item.y = Math.round(10 * item.y) / 10;
	}
	if (item.hasOwnProperty("opacity")) {
		item.opacity = Math.min(Math.max(item.opacity, 0.1), 1) || 1;
		if (item.opacity === 1) delete item.opacity;
	}
	if (item.hasOwnProperty("_children")) {
		if (!Array.isArray(item._children)) item._children = [];
		if (item._children.length > MAX_CHILDREN) item._children.length = MAX_CHILDREN;
		for (var i = 0; i < item._children.length; i++) {
			this.validate(item._children[i]);
		}
	}
}

/** Load the data in the board from a file.
 * @param {string} file - Path to the file where the board data will be read.
*/
BoardData.load = function loadBoard(name) {
	var boardData = new BoardData(name);
	return new Promise((accept) => {
		fs.readFile(boardData.file, function (err, data) {
			try {
				if (err) throw err;
				boardData.board = JSON.parse(data);
				for (id in boardData.board) boardData.validate(boardData.board[id]);
				console.log(boardData.name + " loaded from file.");
			} catch (e) {
				if(SAVE)
				console.error("Unable to read history from " + boardData.file + ". The following error occured: " + e);
				console.log("Creating an empty board.");
				boardData.board = {}
			}
			accept(boardData);
		});
	});
};

module.exports.BoardData = BoardData;
