"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrderStatus = void 0;
var OrderStatus;
(function (OrderStatus) {
    OrderStatus[OrderStatus["Pending"] = 0] = "Pending";
    OrderStatus[OrderStatus["Executed"] = 1] = "Executed";
    OrderStatus[OrderStatus["Cancelled"] = 2] = "Cancelled";
    OrderStatus[OrderStatus["Failed"] = 3] = "Failed";
})(OrderStatus || (exports.OrderStatus = OrderStatus = {}));
