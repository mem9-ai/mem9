package handler

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"strconv"
	"strings"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/runtimeusage"
)

const (
	runtimeNoticeProviderID     = "mem9-official"
	runtimeNoticeWarningPercent = 80
	runtimeNoticeUrgentPercent  = 95
)

type runtimeResponseNotice struct {
	Message      string
	RuntimeState runtimeusage.RuntimeState
}

type runtimeStatusResponse struct {
	Status       string                     `json:"status"`
	Message      string                     `json:"message,omitempty"`
	RuntimeState *runtimeusage.RuntimeState `json:"runtimeState,omitempty"`
}

type memoryRuntimeResponse struct {
	*domain.Memory
	Message      string                     `json:"message,omitempty"`
	RuntimeState *runtimeusage.RuntimeState `json:"runtimeState,omitempty"`
}

type runtimeNoticeCandidate struct {
	priority int
	message  string
}

func (s *Server) runtimeResponseNotice(ctx context.Context, auth *domain.AuthInfo) runtimeResponseNotice {
	if !s.runtimeUsageEnabled() || strings.TrimSpace(s.runtimeUsage.ProviderID()) != runtimeNoticeProviderID {
		return runtimeResponseNotice{}
	}
	state, err := s.runtimeUsage.RuntimeState(ctx, subjectFromAuth(auth))
	if err != nil {
		logger := s.logger
		if logger == nil {
			logger = slog.Default()
		}
		logger.WarnContext(ctx, "runtime state response notice omitted",
			"tenant_id", authTenantID(auth),
			"cluster_id", authClusterID(auth),
			"err", err,
		)
		return runtimeResponseNotice{}
	}
	message := runtimeStateNoticeMessage(state)
	if message == "" {
		return runtimeResponseNotice{}
	}
	return runtimeResponseNotice{
		Message:      message,
		RuntimeState: state,
	}
}

func statusResponseWithRuntimeNotice(status string, notice runtimeResponseNotice) runtimeStatusResponse {
	return runtimeStatusResponse{
		Status:       status,
		Message:      notice.Message,
		RuntimeState: runtimeNoticeState(notice),
	}
}

func memoryResponseWithRuntimeNotice(memory *domain.Memory, notice runtimeResponseNotice) any {
	if notice.Message == "" {
		return memory
	}
	return memoryRuntimeResponse{
		Memory:       memory,
		Message:      notice.Message,
		RuntimeState: runtimeNoticeState(notice),
	}
}

func runtimeNoticeState(notice runtimeResponseNotice) *runtimeusage.RuntimeState {
	if notice.Message == "" {
		return nil
	}
	return &notice.RuntimeState
}

func runtimeStateNoticeMessage(state runtimeusage.RuntimeState) string {
	action := state.RecommendedAction
	candidates := make([]runtimeNoticeCandidate, 0)

	if strings.TrimSpace(state.Mem9APIKey.Status) == runtimeusage.RuntimeAPIKeyStatusInactive {
		candidates = append(candidates, runtimeNoticeCandidate{
			priority: 65,
			message: runtimeNoticeSentence(
				"This API key is inactive.",
				action,
				"Run mem9 setup again or create a new API key to keep memory access available.",
			),
		})
	}

	if runtimeNoticeActionDisplayable(action) {
		candidates = append(candidates, runtimeNoticeCandidate{
			priority: runtimeNoticeActionPriority(action),
			message: runtimeNoticeSentence(
				"Mem9 needs account or billing attention.",
				action,
				"Open the mem9 console to resolve the account or billing state.",
			),
		})
	}

	for _, meter := range state.Meters {
		feature := runtimeNoticeMeterLabel(meter.Meter)
		gate := meter.QuotaGateResult
		outcome := runtimeNoticeString(gate["outcome"])
		mode := runtimeNoticeString(gate["mode"])

		switch outcome {
		case "blocked":
			candidates = append(candidates, runtimeNoticeCandidate{
				priority: 60,
				message: runtimeNoticeSentence(
					fmt.Sprintf("%s is blocked by runtime quota.", feature),
					action,
					"Open the mem9 console to resolve the account or billing state.",
				),
			})
		case "rateLimited":
			candidates = append(candidates, runtimeNoticeCandidate{
				priority: 55,
				message: runtimeNoticeSentence(
					fmt.Sprintf("%s has reached its temporary runtime rate limit.", feature),
					action,
					"Retry later or upgrade your plan to get more included usage.",
				),
			})
		}

		switch mode {
		case "onDemand":
			candidates = append(candidates, runtimeNoticeCandidate{
				priority: 40,
				message: runtimeNoticeSentence(
					fmt.Sprintf("%s is using on-demand usage.", feature),
					action,
					"Review billing settings in the mem9 console.",
				),
			})
		case "postQuota":
			candidates = append(candidates, runtimeNoticeCandidate{
				priority: 40,
				message: runtimeNoticeSentence(
					fmt.Sprintf("%s is using the post-quota request lane.", feature),
					action,
					"Upgrade your plan to get more included usage.",
				),
			})
		}

		for _, budget := range meter.Budgets {
			candidates = append(candidates, runtimeNoticeBudgetCandidates(feature, budget, action)...)
		}
	}

	if len(candidates) == 0 {
		return ""
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		return candidates[i].priority > candidates[j].priority
	})
	return candidates[0].message
}

func runtimeNoticeBudgetCandidates(feature string, budget runtimeusage.RuntimeStatusBudget, action *runtimeusage.RuntimeRecommendedAction) []runtimeNoticeCandidate {
	state := strings.TrimSpace(budget.State)
	numbers := runtimeNoticeBudgetNumbers(budget)
	switch {
	case state == "exhausted":
		return []runtimeNoticeCandidate{{
			priority: 45,
			message: runtimeNoticeSentence(
				fmt.Sprintf("%s has exhausted its %s.", feature, runtimeNoticeBudgetLabel(budget.Type)),
				action,
				runtimeNoticeBudgetFallbackAction(budget.Type),
			),
		}}
	case runtimeNoticeBudgetUrgent(numbers):
		return []runtimeNoticeCandidate{{
			priority: 35,
			message: runtimeNoticeSentence(
				runtimeNoticeBudgetUsageDetail(feature, budget, numbers, true),
				action,
				runtimeNoticeBudgetFallbackAction(budget.Type),
			),
		}}
	case state == "warning" || (numbers.percent != nil && *numbers.percent >= runtimeNoticeWarningPercent):
		return []runtimeNoticeCandidate{{
			priority: 25,
			message: runtimeNoticeSentence(
				runtimeNoticeBudgetUsageDetail(feature, budget, numbers, false),
				action,
				runtimeNoticeBudgetFallbackAction(budget.Type),
			),
		}}
	default:
		return nil
	}
}

type runtimeNoticeBudgetUsage struct {
	percent   *float64
	remaining *int64
	capacity  *int64
}

func runtimeNoticeBudgetNumbers(budget runtimeusage.RuntimeStatusBudget) runtimeNoticeBudgetUsage {
	var numbers runtimeNoticeBudgetUsage
	if budget.Usage != nil {
		numbers.percent = budget.Usage.Percent
		numbers.remaining = budget.Usage.Remaining
	}
	if budget.Capacity.Type == "limited" && budget.Capacity.Value != nil && *budget.Capacity.Value > 0 {
		numbers.capacity = budget.Capacity.Value
	}
	return numbers
}

func runtimeNoticeBudgetUrgent(numbers runtimeNoticeBudgetUsage) bool {
	if numbers.percent != nil && *numbers.percent >= runtimeNoticeUrgentPercent {
		return true
	}
	if numbers.remaining == nil || numbers.capacity == nil {
		return false
	}
	threshold := (*numbers.capacity * 2) / 100
	if threshold < 5 {
		threshold = 5
	}
	return *numbers.remaining <= threshold
}

func runtimeNoticeBudgetUsageDetail(feature string, budget runtimeusage.RuntimeStatusBudget, numbers runtimeNoticeBudgetUsage, preferRemaining bool) string {
	label := runtimeNoticeBudgetLabel(budget.Type)
	if preferRemaining && budget.Type == "includedQuota" && numbers.remaining != nil {
		return fmt.Sprintf("%s has %s included requests remaining.", feature, strconv.FormatInt(*numbers.remaining, 10))
	}
	if numbers.percent != nil {
		return fmt.Sprintf("%s has used %s%% of %s.", feature, runtimeNoticeCompactFloat(*numbers.percent), label)
	}
	if numbers.remaining != nil {
		return fmt.Sprintf("%s has %s units remaining in its %s.", feature, strconv.FormatInt(*numbers.remaining, 10), label)
	}
	return fmt.Sprintf("%s is nearing its %s.", feature, label)
}

func runtimeNoticeSentence(detail string, action *runtimeusage.RuntimeRecommendedAction, fallbackAction string) string {
	return strings.TrimSpace(detail) + " " + runtimeNoticeActionSentence(action, fallbackAction)
}

func runtimeNoticeActionSentence(action *runtimeusage.RuntimeRecommendedAction, fallback string) string {
	if action == nil {
		return fallback
	}
	url := strings.TrimSpace(action.URL)
	code := strings.TrimSpace(action.ProviderActionCode)
	if url != "" {
		switch code {
		case "claimApiKey":
			return fmt.Sprintf("Open %s to claim this API key.", url)
		case "upgradePlan":
			return fmt.Sprintf("Open %s to upgrade your plan.", url)
		case "enableOnDemand":
			return fmt.Sprintf("Open %s to enable billing or on-demand usage.", url)
		case "increaseSpendingLimit":
			return fmt.Sprintf("Open %s to increase your spending limit.", url)
		case "resolveAccountState":
			return fmt.Sprintf("Open %s to resolve your mem9 account state.", url)
		default:
			return fmt.Sprintf("Open %s to resolve this in the mem9 console.", url)
		}
	}
	switch code {
	case "claimApiKey":
		return "Open the mem9 console to claim this API key."
	case "upgradePlan":
		return "Upgrade your plan to get more included usage."
	case "enableOnDemand":
		return "Enable billing or on-demand usage in the mem9 console."
	case "increaseSpendingLimit":
		return "Increase your spending limit in the mem9 console."
	case "resolveAccountState":
		return "Open the mem9 console to resolve your account state."
	}
	return fallback
}

func runtimeNoticeActionDisplayable(action *runtimeusage.RuntimeRecommendedAction) bool {
	if action == nil {
		return false
	}
	return strings.TrimSpace(action.URL) != "" ||
		strings.TrimSpace(action.ProviderActionCode) != "" ||
		strings.TrimSpace(action.Severity) == "blocking" ||
		strings.TrimSpace(action.Severity) == "warning"
}

func runtimeNoticeActionPriority(action *runtimeusage.RuntimeRecommendedAction) int {
	if action != nil && strings.TrimSpace(action.Severity) == "blocking" {
		return 50
	}
	return 20
}

func runtimeNoticeMeterLabel(meter string) string {
	switch strings.TrimSpace(meter) {
	case runtimeusage.MeterMemoryRecallRequests:
		return "mem9 recall"
	case runtimeusage.MeterMemoryWriteRequests:
		return "mem9 memory saving"
	default:
		return "mem9 memory"
	}
}

func runtimeNoticeBudgetLabel(budgetType string) string {
	switch strings.TrimSpace(budgetType) {
	case "includedQuota":
		return "included quota"
	case "spendingLimit":
		return "spending limit"
	case "credits":
		return "credit balance"
	default:
		return "runtime quota"
	}
}

func runtimeNoticeBudgetFallbackAction(budgetType string) string {
	switch strings.TrimSpace(budgetType) {
	case "spendingLimit", "credits":
		return "Review billing settings in the mem9 console."
	default:
		return "Upgrade your plan to get more included usage."
	}
}

func runtimeNoticeString(value any) string {
	text, _ := value.(string)
	return strings.TrimSpace(text)
}

func runtimeNoticeCompactFloat(value float64) string {
	if value == float64(int64(value)) {
		return strconv.FormatInt(int64(value), 10)
	}
	return strconv.FormatFloat(value, 'f', 1, 64)
}

func authTenantID(auth *domain.AuthInfo) string {
	if auth == nil {
		return ""
	}
	return auth.TenantID
}

func authClusterID(auth *domain.AuthInfo) string {
	if auth == nil {
		return ""
	}
	return auth.ClusterID
}
