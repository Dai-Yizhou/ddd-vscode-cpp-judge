#pragma once

#include <algorithm>
#include <functional>
#include <iterator>
#include <memory>
#include <utility>
#include <type_traits>
#include <unordered_map>
#include <vector>

namespace __gnu_pbds {

struct rb_tree_tag {};
struct null_type {};
template <typename...>
struct tree_order_statistics_node_update;

template <typename Key, typename Mapped, typename Compare = std::less<Key>, typename Tag = rb_tree_tag, template <typename...> class NodeUpdate = tree_order_statistics_node_update>
class tree {
    using value_type = std::conditional_t<std::is_same_v<Mapped, null_type>, Key, std::pair<const Key, Mapped>>;
    using storage_type = std::vector<value_type>;

public:
    using key_type = Key;
    using mapped_type = Mapped;
    using size_type = typename storage_type::size_type;
    using iterator = typename storage_type::iterator;
    using const_iterator = typename storage_type::const_iterator;

    bool insert(const value_type& value) {
        auto position = lower_bound(value);
        if (position != values_.end() && equivalent(*position, value)) {
            return false;
        }
        values_.insert(position, value);
        return true;
    }

    size_type erase(const key_type& key) {
        auto position = lower_bound_key(key);
        if (position == values_.end() || !equivalent_key(*position, key)) {
            return 0;
        }
        values_.erase(position);
        return 1;
    }

    iterator find(const key_type& key) {
        auto position = lower_bound_key(key);
        return position != values_.end() && equivalent_key(*position, key) ? position : values_.end();
    }

    const_iterator find(const key_type& key) const {
        auto position = lower_bound_key(key);
        return position != values_.end() && equivalent_key(*position, key) ? position : values_.end();
    }

    size_type order_of_key(const key_type& key) const {
        return static_cast<size_type>(std::lower_bound(values_.begin(), values_.end(), key,
            [this](const value_type& value, const key_type& candidate) {
                return compare_(key_of(value), candidate);
            }) - values_.begin());
    }

    iterator find_by_order(size_type order) {
        return order < values_.size() ? values_.begin() + static_cast<std::ptrdiff_t>(order) : values_.end();
    }

    const_iterator find_by_order(size_type order) const {
        return order < values_.size() ? values_.begin() + static_cast<std::ptrdiff_t>(order) : values_.end();
    }

    size_type size() const { return values_.size(); }
    bool empty() const { return values_.empty(); }
    iterator begin() { return values_.begin(); }
    const_iterator begin() const { return values_.begin(); }
    iterator end() { return values_.end(); }
    const_iterator end() const { return values_.end(); }

private:
    static const key_type& key_of(const value_type& value) {
        if constexpr (std::is_same_v<Mapped, null_type>) {
            return value;
        } else {
            return value.first;
        }
    }

    bool compare_key(const key_type& left, const key_type& right) const {
        return compare_(left, right);
    }

    bool equivalent_key(const value_type& value, const key_type& key) const {
        return !compare_key(key_of(value), key) && !compare_key(key, key_of(value));
    }

    bool equivalent(const value_type& left, const value_type& right) const {
        return equivalent_key(left, key_of(right));
    }

    iterator lower_bound(const value_type& value) {
        return std::lower_bound(values_.begin(), values_.end(), key_of(value),
            [this](const value_type& current, const key_type& key) { return compare_(key_of(current), key); });
    }

    iterator lower_bound_key(const key_type& key) {
        return lower_bound_value(key);
    }

    const_iterator lower_bound_key(const key_type& key) const {
        return std::lower_bound(values_.begin(), values_.end(), key,
            [this](const value_type& current, const key_type& candidate) { return compare_(key_of(current), candidate); });
    }

    iterator lower_bound_value(const key_type& key) {
        return std::lower_bound(values_.begin(), values_.end(), key,
            [this](const value_type& current, const key_type& candidate) { return compare_(key_of(current), candidate); });
    }

    Compare compare_;
    storage_type values_;
};

template <typename Key, typename Mapped, typename Hash = std::hash<Key>, typename Eq = std::equal_to<Key>>
using gp_hash_table = std::unordered_map<Key, Mapped, Hash, Eq>;

}
