def calculate_settlement(player_balances: dict) -> list:
    """
    Minimize number of transactions to settle debts.
    player_balances: {player_id: net_amount} where positive = owed money, negative = owes money
    Returns list of (from_player_id, to_player_id, amount)
    """
    creditors = sorted([(pid, amt) for pid, amt in player_balances.items() if amt > 0], key=lambda x: -x[1])
    debtors = sorted([(pid, amt) for pid, amt in player_balances.items() if amt < 0], key=lambda x: x[1])

    creditors = [list(x) for x in creditors]
    debtors = [list(x) for x in debtors]

    transactions = []
    i, j = 0, 0

    while i < len(creditors) and j < len(debtors):
        creditor_id, credit = creditors[i]
        debtor_id, debt = debtors[j]

        amount = min(credit, -debt)
        transactions.append((debtor_id, creditor_id, amount))

        creditors[i][1] -= amount
        debtors[j][1] += amount

        if creditors[i][1] == 0:
            i += 1
        if debtors[j][1] == 0:
            j += 1

    return transactions
