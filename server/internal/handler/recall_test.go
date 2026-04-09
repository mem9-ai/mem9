package handler

import "testing"

func TestClassifyRecallQueryShape_Bilingual(t *testing.T) {
	tests := []struct {
		name  string
		query string
		want  recallQueryShape
	}{
		{name: "general english", query: "tell me about john", want: recallQueryShapeGeneral},
		{name: "entity english", query: "who is john", want: recallQueryShapeEntity},
		{name: "count english", query: "how many deployments happened", want: recallQueryShapeCount},
		{name: "time english", query: "when did it ship", want: recallQueryShapeTime},
		{name: "location english", query: "where is the office", want: recallQueryShapeLocation},
		{name: "exact english", query: "what company does john like", want: recallQueryShapeExact},
		{name: "entity chinese", query: "谁负责这个项目", want: recallQueryShapeEntity},
		{name: "entity chinese 哪一个", query: "哪一个团队负责", want: recallQueryShapeEntity},
		{name: "count chinese 多少", query: "多少次发布失败了", want: recallQueryShapeCount},
		{name: "count chinese 有多少", query: "有多少个服务", want: recallQueryShapeCount},
		{name: "count chinese 几个", query: "几个团队参与了", want: recallQueryShapeCount},
		{name: "time chinese 什么时候", query: "什么时候上线的", want: recallQueryShapeTime},
		{name: "time chinese 何时", query: "何时发布", want: recallQueryShapeTime},
		{name: "time chinese 几号", query: "几号发版", want: recallQueryShapeTime},
		{name: "time chinese 什么时间", query: "什么时间发布", want: recallQueryShapeTime},
		{name: "location chinese 哪里", query: "哪里部署的", want: recallQueryShapeLocation},
		{name: "location chinese 在哪", query: "在哪办公", want: recallQueryShapeLocation},
		{name: "location chinese 什么地方", query: "什么地方部署", want: recallQueryShapeLocation},
		{name: "location chinese 哪座城市", query: "哪座城市有办公室", want: recallQueryShapeLocation},
		{name: "exact chinese", query: "什么公司是客户", want: recallQueryShapeExact},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := classifyRecallQueryShape(tt.query); got != tt.want {
				t.Fatalf("classifyRecallQueryShape(%q) = %v, want %v", tt.query, got, tt.want)
			}
		})
	}
}

func TestRecallAnswerUnitCount_CJKAware(t *testing.T) {
	if got := recallAnswerUnitCount("在上海办公"); got <= 1 {
		t.Fatalf("expected CJK-aware token count > 1, got %d", got)
	}
}

func TestAnswerEvidenceBonus_BilingualSignals(t *testing.T) {
	tests := []struct {
		name   string
		shape  recallQueryShape
		strong string
		weak   string
	}{
		{
			name:   "count chinese list and numerals",
			shape:  recallQueryShapeCount,
			strong: "2024年发布了三次，分别在1月、3月和5月。",
			weak:   "经常发布。",
		},
		{
			name:   "time chinese date",
			shape:  recallQueryShapeTime,
			strong: "2024年3月15日上线",
			weak:   "很快上线",
		},
		{
			name:   "location chinese verb cue",
			shape:  recallQueryShapeLocation,
			strong: "在上海办公",
			weak:   "经常出差",
		},
		{
			name:   "location chinese direct cue",
			shape:  recallQueryShapeLocation,
			strong: "位于北京",
			weak:   "经常出差",
		},
		{
			name:   "exact chinese named answer",
			shape:  recallQueryShapeExact,
			strong: "清华大学",
			weak:   "客户很多",
		},
		{
			name:   "exact mixed script quoted brand",
			shape:  recallQueryShapeExact,
			strong: `“Under Armour”`,
			weak:   "户外品牌",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			strong := answerEvidenceBonus(tt.shape, tt.strong)
			weak := answerEvidenceBonus(tt.shape, tt.weak)
			if strong <= weak {
				t.Fatalf("answerEvidenceBonus(%v, %q) = %.2f, want > %.2f for %q", tt.shape, tt.strong, strong, weak, tt.weak)
			}
		})
	}
}
