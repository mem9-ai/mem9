package handler

import (
	"strconv"
	"strings"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
)

// Read models for Space Chain control-plane responses.
//
// The domain structs carry plaintext chain keys and Space keys because the
// create endpoints and the repositories need them. Read endpoints must never
// echo those values, so they respond with these views instead.

type spaceChainView struct {
	ID              string                  `json:"id"`
	ProjectID       string                  `json:"project_id,omitempty"`
	Name            string                  `json:"name"`
	Description     string                  `json:"description,omitempty"`
	DeletedAt       *time.Time              `json:"deleted_at,omitempty"`
	DeletedByUserID string                  `json:"deleted_by_user_id,omitempty"`
	CreatedAt       time.Time               `json:"created_at"`
	UpdatedAt       time.Time               `json:"updated_at"`
	Bindings        []spaceChainBindingView `json:"bindings,omitempty"`
	Nodes           []spaceChainNodeView    `json:"nodes,omitempty"`
}

type spaceChainBindingView struct {
	ID                string     `json:"id"`
	ChainID           string     `json:"chain_id"`
	MaskedChainAPIKey string     `json:"masked_chain_api_key"`
	Disabled          bool       `json:"disabled"`
	DisabledAt        *time.Time `json:"disabled_at,omitempty"`
	DisabledByUserID  string     `json:"disabled_by_user_id,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
}

type spaceChainNodeView struct {
	ID                       string    `json:"id"`
	ChainID                  string    `json:"chain_id"`
	ExternalSpaceID          string    `json:"external_space_id,omitempty"`
	DisplayName              string    `json:"display_name,omitempty"`
	Position                 int       `json:"position"`
	RoutingPolicyEnabled     bool      `json:"routing_policy_enabled"`
	RoutingPolicyPrompt      string    `json:"routing_policy_prompt,omitempty"`
	RoutingPolicyWebhookOnly bool      `json:"routing_policy_webhook_only"`
	CreatedAt                time.Time `json:"created_at"`
	UpdatedAt                time.Time `json:"updated_at"`
}

func newSpaceChainView(chain *domain.SpaceChain) spaceChainView {
	return spaceChainView{
		ID:              chain.ID,
		ProjectID:       chain.ProjectID,
		Name:            chain.Name,
		Description:     chain.Description,
		DeletedAt:       chain.DeletedAt,
		DeletedByUserID: chain.DeletedByUserID,
		CreatedAt:       chain.CreatedAt,
		UpdatedAt:       chain.UpdatedAt,
		Bindings:        newSpaceChainBindingViews(chain.Bindings),
		Nodes:           newSpaceChainNodeViews(chain.Nodes),
	}
}

// newSpaceChainBindingViews keeps a nil list nil so an empty source still
// encodes as null where the envelope has no omitempty.
func newSpaceChainBindingViews(bindings []domain.SpaceChainBinding) []spaceChainBindingView {
	if bindings == nil {
		return nil
	}
	out := make([]spaceChainBindingView, len(bindings))
	for i, binding := range bindings {
		out[i] = spaceChainBindingView{
			ID:                binding.ID,
			ChainID:           binding.ChainID,
			MaskedChainAPIKey: visibleMask(binding.ChainAPIKey),
			Disabled:          binding.Disabled,
			DisabledAt:        binding.DisabledAt,
			DisabledByUserID:  binding.DisabledByUserID,
			CreatedAt:         binding.CreatedAt,
		}
	}
	return out
}

func newSpaceChainNodeView(node domain.SpaceChainNode) spaceChainNodeView {
	return spaceChainNodeView{
		ID:                       node.ID,
		ChainID:                  node.ChainID,
		ExternalSpaceID:          node.ExternalSpaceID,
		DisplayName:              node.DisplayName,
		Position:                 node.Position,
		RoutingPolicyEnabled:     node.RoutingPolicyEnabled,
		RoutingPolicyPrompt:      node.RoutingPolicyPrompt,
		RoutingPolicyWebhookOnly: node.RoutingPolicyWebhookOnly,
		CreatedAt:                node.CreatedAt,
		UpdatedAt:                node.UpdatedAt,
	}
}

func newSpaceChainNodeViews(nodes []domain.SpaceChainNode) []spaceChainNodeView {
	if nodes == nil {
		return nil
	}
	out := make([]spaceChainNodeView, len(nodes))
	for i, node := range nodes {
		out[i] = newSpaceChainNodeView(node)
	}
	return out
}

const (
	maskedKeyPrefixBytes = 6
	maskedKeySuffixBytes = 4
	// Keys shorter than this are reported by length only, because showing
	// the prefix and suffix would reveal most of the key.
	maskedKeyMinBytes = 12
)

// visibleMask returns the display form of an API key. It is byte based and
// carries no digest, so other services can recompute it from a key they hold
// and compare it with the value mem9 returns. The result is never a usable key.
func visibleMask(key string) string {
	key = strings.TrimSpace(key)
	if len(key) < maskedKeyMinBytes {
		return "len" + strconv.Itoa(len(key))
	}
	return key[:maskedKeyPrefixBytes] + "..." + key[len(key)-maskedKeySuffixBytes:]
}
